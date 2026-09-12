// Ruleset de Hunt (FUN-43, §14) — o primeiro ruleset concreto, e o molde dos outros cinco.
//
// Um ruleset define QUATRO coisas, e são as mesmas para hunt, treino, quest, boss e guild
// war. Vale escrever de novo aqui, porque é o teste de fogo da interface:
//
//   | como entra          | pelo menu, com dificuldade escolhida; instância criada na entrada |
//   | o que encerra       | ação manual, regra de saída, ou morte (§14.8)                     |
//   | o que a morte faz   | encerra — devolver à PZ é a FUN-38, do lado do servidor           |
//   | como recompensa     | loot, XP e abate no Bestiário, bloqueados com stamina zero        |
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
  Item, Monster, Progression, Route, Skill, Spell, SpawnPoint, Stamina, Supply, Tilemap,
  Vocation,
} from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { NOT_IN_CATALOG, balanceOf, castSpell, useSupply } from '../casting.js';
import type { CastResult, SpellAim, SpellTarget } from '../casting.js';
import type { CreatureHealed, SpellCastTarget } from '../combat-events.js';
import { resolveDamage } from '../combat/damage.js';
import type { Defender } from '../combat/damage.js';
import { forgetActor, recordDamage, resolveDeath } from '../death.js';
import type { KillCredit, Victim } from '../death.js';
import type { BestiaryConfig } from '../bestiary.js';
import { Spawner } from '../hunt/spawner.js';
import type { SpawnerState } from '../hunt/spawner.js';
import { rollLoot } from '../loot.js';
import type { LootItem } from '../loot.js';
import type { CarriedItem } from '../inventory.js';
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
import { applyDeathPenalty, grantXp, statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { TileOccupancy, canOccupy, move, movementDuration, place } from '../movement.js';
import type { Movable, MoveResult, WorldPoint } from '../movement.js';
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

/**
 * A mira de uma magia que não mira ninguém (cura). Congelada e compartilhada, como `NO_HITS`
 * em `casting.ts`: uma cura por segundo por personagem não precisa alocar um vetor vazio.
 */
const NO_SPELL_TARGETS: readonly SpellCastTarget[] = [];

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
  /** Catálogo de itens (FUN-76). O que a arma equipada bate sai daqui. */
  readonly items: ReadonlyMap<string, Item>;
  /**
   * Os marcos do Bestiário e o bônus por marco (§18, FUN-113). Ausente é uma hunt em que o
   * abate conta, mas nenhum marco fecha e a XP sai sem bônus — o conteúdo de teste que não
   * fala de progressão permanente. É a config quem define marco, não quem autoriza contar.
   */
  readonly bestiary?: BestiaryConfig;
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
  /** Ver `HuntRuleset.#warnedFullBackpack`. Ausente é `false`: snapshot anterior à FUN-88. */
  readonly warnedFullBackpack?: boolean;
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
  /** Ver `HuntRuleset.#running`. Ausente é `true`: o lure começa juntando (FUN-87). */
  readonly luring?: boolean;
  /** Ver `HuntRuleset.#ringReplaced`. Ausente é `null`: o dedo estava vazio. */
  readonly ringReplaced?: string | null;
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
   * Já avisou que a mochila encheu? A notícia sai UMA vez (FUN-88).
   *
   * Mesma razão do aviso de stamina: uma linha por item que não coube encheria a lista curta
   * da tela de retorno, e o que o jogador precisa saber é que ela encheu.
   */
  #warnedFullBackpack = false;

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
   * O personagem está CORRENDO para juntar monstros (§13.7, FUN-87)? Ver `#luring`.
   *
   * Começa em `true` porque o lure começa juntando: um personagem que nasce "lutando" com zero
   * monstros ao redor pararia na rota esperando alguém aparecer.
   */
  #running = true;

  /**
   * Que anel estava no dedo quando a máquina equipou o dela (§13.8, FUN-87).
   *
   * `null` é "o dedo estava vazio". Precisa do snapshot: sem ele, uma hunt retomada com o anel
   * equipado esqueceria o que restaurar, e o jogador acabaria a hunt sem o anel que era dele.
   */
  #ringReplaced: string | null = null;

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
   * As skills indexadas pelo que as alimenta (FUN-75).
   *
   * Montado UMA vez, na construção. `map.values()` aloca um iterador por chamada, e
   * `#scaledPower` e `#gainSkills` rodam a cada golpe e a cada magia — com 5.000 instâncias
   * isso é o coletor trabalhando para percorrer duas entradas. É a mesma conta que fez o
   * índice de monstro por subject valer a pena.
   */
  readonly #skillsByGain: Readonly<Record<Skill['gain']['on'], readonly Skill[]>>;

  /**
   * A mira da magia, reaproveitada pela mesma razão que `#botView` (FUN-92).
   *
   * Três vetores que andam juntos e são limpos a cada lançamento: os alvos como `castSpell` os
   * enxerga, os monstros correspondentes — quem leva o dano — e o objeto de mira. Uma magia
   * por segundo por personagem, vezes 5.000 instâncias, é alocação que dá para não fazer.
   *
   * Mutáveis de propósito: `castSpell` só lê, e quem escreve é `#aimAt`, num lugar só.
   */
  readonly #spellTargets: MutableSpellTarget[] = [];
  /** Os monstros na mesma ordem de `#spellTargets`: é quem leva o dano de cada rolagem. */
  readonly #spellHits: MonsterRuntime[] = [];
  readonly #aim: { distance: number; targets: readonly SpellTarget[] } = {
    distance: 0, targets: [],
  };

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
    this.#skillsByGain = {
      'melee-hit': [...options.skills.values()].filter((sk) => sk.gain.on === 'melee-hit'),
      'spell-cast': [...options.skills.values()].filter((sk) => sk.gain.on === 'spell-cast'),
    };
    this.#walker = new RouteWalker(options.route);
    this.#spawner = new Spawner(options.route.spawnPoints.length, difficulty);
    this.#world = new TileOccupancy(options.map);
  }

  get monsters(): readonly MonsterRuntime[] {
    return this.#monsters;
  }

  /**
   * O andar da instância. Monstro vive numa grade 2D; o `z` é do mapa, e quem monta o
   * `session-state` precisa dele para pôr o monstro no mesmo andar do personagem (FUN-103).
   */
  get floor(): number {
    return this.#world.map.z;
  }

  /** O mapa da instância (FUN-120): é o que o cliente busca para desenhar a hunt. */
  get mapId(): string {
    return this.#world.map.id;
  }

  /** O ambiente da hunt (FUN-121), do conteúdo — `cavern` no bueiro. Ausente é superfície. */
  get ambience(): 'surface' | 'cavern' | undefined {
    return this.#options.hunt.ambience;
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
    // Velocidade e capacidade vêm da tabela, como `maxHealth` — e são repostas na entrada
    // porque snapshot anterior traz zero: zero é "não carrega nada" e "não anda" (FUN-119).
    const stats = statsForLevel(
      character.level, this.#vocationOf(character), this.#options.progression,
    );
    character.speed = stats.speed;
    if (character.capacity <= 0) character.capacity = stats.capacity;
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

    if (what === 'health') {
      // Só a barra, sem `creature-healed` (FUN-109): um "+1" flutuando por segundo a hunt
      // inteira é ruído, mas a barra precisa andar. E só quando REPÔS — de vida cheia, nada
      // mudou, e um evento por segundo para dizer isso é o que uma hunt desanexada de oito
      // horas não precisa produzir.
      if (character.heal(1) > 0) this.#emitCharacterHealth(session, character);
    } else {
      character.mana = Math.min(character.maxMana, character.mana + 1);
    }

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
      // Descer de level reescreve `maxHealth` pela tabela (`retarget`), e a barra é anunciada
      // de TODO lugar que a escreve (FUN-109). A vida é zero — ele morreu —, mas o máximo
      // mudou, e o cliente que só recebeu o golpe fatal ficaria com um "0 / máximo do level
      // antigo" até a reanexação.
      this.#emitCharacterHealth(session, character);
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
      warnedFullBackpack: this.#warnedFullBackpack,
      warnedNoGold: this.#warnedNoGold,
      staminaAnchorMs: this.#staminaAnchorMs,
      playerAttackReady: this.#playerAttackReady,
      botScheduled: BOT_CATEGORIES.filter((category) => !this.#botReady[category]),
      luring: this.#running,
      ringReplaced: this.#ringReplaced,
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
    // Snapshot anterior à FUN-119 não traz a velocidade; ela é do conteúdo, e repor daqui é
    // o que impede um monstro restaurado de andar com velocidade zero.
    for (const monster of this.#monsters) {
      if (monster.speed > 0) continue;
      monster.speed = this.#options.monsters.get(monster.monsterId)?.speed ?? 0;
    }
    this.#monsterBySubject.clear();
    for (const monster of this.#monsters) {
      this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    }
    this.#nextCreatureId = restored.nextCreatureId;
    this.#warnedExhausted = restored.warnedExhausted;
    this.#warnedFullBackpack = restored.warnedFullBackpack ?? false;
    this.#warnedNoGold = restored.warnedNoGold ?? false;
    this.#staminaAnchorMs = restored.staminaAnchorMs;
    this.#playerAttackReady = restored.playerAttackReady ?? true;
    for (const category of BOT_CATEGORIES) {
      this.#botReady[category] = !(restored.botScheduled ?? []).includes(category);
    }
    // Sem isto, uma hunt retomada no meio de um lure de vinte monstros recomeçaria "correndo"
    // e continuaria juntando por cima do que já estava junto.
    this.#running = restored.luring ?? true;
    this.#ringReplaced = restored.ringReplaced ?? null;
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
      speed: definition.speed,
      cooldowns: {},
    });
    this.#monsters.push(monster);
    this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    // O tile já foi escolhido livre pelo spawner; `place` é quem o marca como ocupado, e é
    // ele que recusaria se algo tivesse mudado entre uma coisa e outra.
    place(this.#world, monster, request.position);
    this.#spawner.occupy(request.slot, monster.id);

    const subjectOf = monsterSubject(monster.id);
    // DEPOIS do `place`: é ele que pode recusar o tile, e anunciar uma posição que ainda pode
    // ser recusada publicaria um monstro onde ele não está (FUN-103).
    session.emit({
      kind: 'creature-appeared', creatureId: subjectOf, monsterId: definition.id,
      // O `z` é do mapa, como o passo faz em `move()`: monstro vive numa grade 2D e o andar é
      // propriedade da instância, não da criatura.
      position: { ...monster.position, z: this.#world.map.z },
      health: monster.health, maxHealth: definition.health,
    });
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
    // Snapshot anterior à FUN-119 traz velocidade zero; a tabela repõe.
    if (character.speed <= 0) {
      character.speed = statsForLevel(
        character.level, this.#vocationOf(character), this.#options.progression,
      ).speed;
    }
    // O vencimento seguinte é a duração do passo que este evento der — e, quando ele não der
    // passo nenhum, a de um passo daqui (FUN-119): quem parou volta a olhar em volta no ritmo
    // em que andaria. Agendar ANTES de decidir, com a duração de um passo daqui, dá o mesmo
    // resultado para quem fica e adianta o de quem anda para chão mais lento; por isso o
    // reagendamento fica no fim, com o que de fato aconteceu.
    const stepped = this.#playerStep(session, character);
    const cadence = stepped !== null && stepped.ok
      ? stepped.durationMs
      : movementDuration(this.#world, character, character.position, character.position);
    session.scheduleIn(PLAYER_STEP, cadence, {
      priority: EventPriority.Movement, subject: characterId,
    });
  }

  /** O corpo do passo do personagem; devolve o passo dado, ou `null` quando ficou parado. */
  #playerStep(session: Session, character: CharacterRuntime): MoveResult | null {

    // Para para lutar, e retoma DEPOIS no mesmo índice (FUN-42). Como ele para assim que há
    // monstro ao alcance, nunca pisa no tile de um: o combate começa antes do passo.
    //
    // Com LURE configurado (§13.7), quem decide parar deixa de ser "há um ao alcance" e passa a
    // ser a CONTAGEM: correr acumulando até `max`, limpar até cair abaixo de `min`.
    if (this.#attackTarget(character) !== null && !this.#luring(character)) {
      this.#walker.stop();
      this.#armPlayerAttack(session);
      return null;
    }

    // Ninguém ao alcance, e a postura pode mandar ele SAIR DA ROTA atrás do alvo (FUN-85).
    // Com `stand` — o padrão — isto não roda, e o comportamento é o de sempre.
    const posture = this.#holdPosture(session, character);
    if (posture !== false) {
      this.#armPlayerAttack(session);
      return posture;
    }

    // Ninguém ao alcance: anda. Com postura `stand` o personagem NÃO persegue — ele percorre a
    // rota e deixa o monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
    this.#walker.resume();
    const to = this.#walker.step();
    if (to === null) return null;
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
    return result;
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
  #holdPosture(session: Session, character: CharacterRuntime): MoveResult | null | false {
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
    // `null` é "a postura decidiu ficar parado": a cadência seguinte é a de um passo daqui.
    if (d === want) return null;

    const to = d > want
      ? greedyStep(from, target.position, blocked)
      : fleeStep(from, target.position, blocked);
    // Empacado — cercado, ou contra a parede recuando. Esperar é o comportamento certo, e é o
    // mesmo que o passo guloso do monstro já faz (ADR 0009).
    if (to === null) return null;

    this.#walker.stop();
    return this.#step(session, character, { ...to, z: from.z }, character.id);
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
   * `PLAYER_STEP` descobre e reentra pelo tile mais próximo. Mas o passo manual É um passo
   * (FUN-122): o próximo vencimento do bot conta a partir dele. Sem isto, o `PLAYER_STEP` já
   * agendado — com a cadência do passo anterior — vencia logo depois, e o personagem dava
   * dois passos dentro da duração de um.
   */
  requestMove(session: Session, characterId: string, to: GridPoint): MoveResult {
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'tile-blocked' };
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    const result = this.#step(session, character, { ...to, z: character.position.z }, characterId);
    if (result.ok) {
      session.cancelEvent(PLAYER_STEP, characterId);
      session.scheduleIn(PLAYER_STEP, result.durationMs, {
        priority: EventPriority.Movement, subject: characterId,
      });
    }
    return result;
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
      // E o anel sai quando a cura devolve o HP, ou quando a magia derruba a mana abaixo do
      // piso — os dois lados da máquina do §13.8 dependem do que a ação acabou de mudar.
      this.#applyRingSwap(session, character);
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

    const aim = spell.effect.kind === 'damage'
      ? this.#aimAt(character, spell.effect.range, spell.effect.area?.radius ?? 0)
      : null;

    const result = castSpell(
      character, spell, aim, session.nowMs, this.#options.combat, session.rng,
      // A skill de magia escala o poder, como a de arma escala o golpe (FUN-75).
      this.#scaledPower(character, 'spell-cast', 1),
    );
    if (!result.ok) return result;
    // A magia SAIU: a mana gasta é o que ela rende de skill (§9.4). Recusa não rende nada —
    // não gastou mana, não praticou.
    this.#gainSkills(session, character, 'spell-cast', spell.manaCost);

    // UMA vez, ANTES dos golpes (FUN-109): o cliente desenha o efeito no lançador e nos alvos
    // e só depois faz cada número cair. A ordem é contrato.
    //
    // `targets` é um vetor NOVO, e não `#spellHits`: aquele é reaproveitado e limpo a cada
    // lançamento, e o evento é drenado pelo hospedeiro DEPOIS — quando `#spellHits` já seria a
    // mira da magia seguinte. É a única alocação por lançamento que este arquivo faz de
    // propósito, e ela é do tamanho da mira.
    session.emit({
      kind: 'spell-cast', casterId: character.id, spellId: spell.id,
      casterPosition: this.#at(character),
      targets: aim === null
        ? NO_SPELL_TARGETS
        : this.#spellHits.map((m) => ({ creatureId: m.subject, position: this.#at(m) })),
    });
    if (aim === null) {
      // Magia de cura: o que repôs, se repôs. `healed` já é o que ENTROU na barra, não o que
      // o efeito prometia — e de vida cheia é zero, sem número nenhum a flutuar.
      this.#emitHealed(session, character, result.healed, 'spell');
      return result;
    }

    // Aplicar depois de colher TODOS os alvos, e não durante (FUN-92).
    //
    // `#onMonsterDied` faz `this.#monsters = this.#monsters.filter(...)`: resolver morte no
    // meio de uma varredura sobre `#monsters` é varrer um array que está sendo trocado, e os
    // alvos depois do que morreu ficariam de fora. Colher primeiro fecha essa porta.
    // Nenhum monstro entra duas vezes na mesma mira — o principal é excluído do laço do raio —,
    // então não há como um deles já estar morto quando chega a vez dele. Uma conferência de
    // `alive` aqui seria código que nenhum teste alcança.
    for (let i = 0; i < this.#spellHits.length; i += 1) {
      const monster = this.#spellHits[i] as MonsterRuntime;
      const damage = result.hits[i] ?? 0;
      // Por ALVO, não a soma da área: "maior hit" é o maior golpe que alguém levou, e somar
      // uma área faria uma magia fraca em cinco alvos superar a mais forte do jogo em um.
      session.aggregates.bestSpellHit = Math.max(session.aggregates.bestSpellHit, damage);
      // Aplicar é também ATRIBUIR: o dano de magia conta para quem matou, como o do golpe.
      const applied = monster.receiveDamage(damage);
      recordDamage(monster.contribution, character.id, applied);
      // O golpe antes da barra, com o APLICADO — a mesma regra do `#strike`.
      session.emit({
        kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
        amount: applied, source: 'spell', position: this.#at(monster),
      });
      this.#emitHealth(session, monster);
      if (!monster.alive) resolveDeath(session, { kind: 'monster', monster });
    }
    return result;
  }

  /**
   * Colhe quem a magia atinge: o alvo principal primeiro, depois quem cai no raio (FUN-92).
   *
   * `radius` zero é alvo único — um caso do mesmo caminho, e não um ramo à parte. Área é
   * distância de Chebyshev a partir do ALVO, a mesma métrica da grade.
   *
   * A ordem é CONTRATO: cada alvo consome uma rolagem do `Rng` da sessão, e ela é a ordem da
   * lista de monstros, que é a de nascimento. Trocar a ordem troca qual sorteio cai em quem, e
   * a mesma semente passa a render uma hunt diferente.
   *
   * Os dois vetores são REAPROVEITADOS, como `#botView` e `#spellTarget`: uma magia por
   * segundo por personagem, vezes 5.000 instâncias, é alocação que dá para não fazer.
   */
  #aimAt(character: CharacterRuntime, range: number, radius: number): SpellAim | null {
    // Alcance da MAGIA, não o da arma — e isto era um defeito desde a FUN-74, que só apareceu
    // quando o teste de área foi escrito. `#attackTarget` para no alcance do golpe, então uma
    // magia de alcance 3 nunca alcançava além de 1: a conferência de alcance dentro de
    // `castSpell` jamais era a restrição que mordia, porque a seleção já tinha mordido antes.
    const primary = selectTarget(this.#targeting, this.#monsters, character.position, range);
    if (primary === null) return null;

    this.#spellHits.length = 0;
    this.#spellTargets.length = 0;
    this.#collect(primary);

    if (radius > 0) {
      for (const monster of this.#monsters) {
        if (monster === primary || !monster.alive) continue;
        if (distance(primary.position, monster.position) > radius) continue;
        this.#collect(monster);
      }
    }

    this.#aim.distance = distance(character.position, primary.position);
    this.#aim.targets = this.#spellTargets;
    return this.#aim;
  }

  /** Põe o monstro na mira, com a armadura que o conteúdo dá a ele. */
  #collect(monster: MonsterRuntime): void {
    this.#spellHits.push(monster);
    // Monstro não esquiva do jogador — é a mesma regra do `#strike`, e ela vale igual para
    // magia. Quando esquiva de monstro existir, vem do conteúdo e os dois leem do mesmo campo.
    this.#spellTargets.push({
      armor: this.#options.monsters.get(monster.monsterId)?.armor ?? 0,
      dodgeChance: 0,
    });
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
      // E a CONTAGEM, que é outra pergunta: "gastei 4.000 de gold" e "bebi 80 poções" contam
      // coisas diferentes sobre a mesma hunt, e o §16.1 pede as duas.
      session.aggregates.suppliesUsed += 1;
      // O uso ANTES do que ele repôs (FUN-109), como a magia sai antes dos golpes dela. Uma
      // poção de mana para aqui: `healed` é zero e a barra de mana não é assunto desta issue.
      session.emit({
        kind: 'supply-used', characterId: character.id, supplyId: supply.id,
        position: this.#at(character),
      });
      this.#emitHealed(session, character, result.healed, 'supply');
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

  /**
   * O personagem está CORRENDO para juntar monstros, em vez de parar para lutar (§13.7)?
   *
   * Máquina de dois estados com dois limiares, e a separação é o ponto: com um limiar só, a
   * contagem oscilando em torno dele faria o personagem alternar entre correr e parar a cada
   * monstro que morre — e um personagem que alterna não faz nem uma coisa nem outra.
   *
   *   correndo  --(chegou em `max`)-->  lutando
   *   lutando   --(caiu abaixo de `min`)-->  correndo
   *
   * Ele NÃO deixa de atacar enquanto corre: o golpe continua saindo em quem estiver ao alcance
   * (`#armPlayerAttack` é chamado no fim do passo). O que muda é ele não PARAR — e é assim que
   * "correr acumulando" funciona sem pathfinding novo, porque o passo guloso dos monstros já
   * os faz seguir.
   */
  #luring(character: CharacterRuntime): boolean {
    const lure = this.#bot?.lure;
    if (lure === undefined) return false;

    const perto = countTargets(
      this.#targeting, this.#monsters, character.position,
      this.#options.targetSearchRadius ?? 8,
    );
    if (this.#running) {
      if (perto >= lure.max) this.#running = false;
    } else if (perto < lure.min) {
      this.#running = true;
    }
    return this.#running;
  }

  /**
   * A máquina de estados do anel (§13.8, FUN-87).
   *
   *   sem anel  --(HP < equipBelow  E  mana >= manaFloor)-->  com anel
   *   com anel  --(HP > removeAbove  OU  mana < manaFloor)-->  sem anel
   *
   * **Os limiares são separados, e é o ponto inteiro da issue.** Com um só, o HP oscilando em
   * torno dele troca o anel a cada golpe — e trocar anel é uma ação por vez que o personagem
   * não está usando para lutar. Entre `equipBelow` e `removeAbove` nada acontece, por
   * construção: nenhum dos dois lados dispara ali.
   *
   * `manaFloor` desativa a máquina: um anel que custa mana não vale a mana que falta para
   * curar. Ele derruba o anel também quando já está equipado — desativar pela metade seria
   * gastar a mana justamente quando ela é escassa.
   *
   * Não faz nada com o dedo quando o jogador nunca configurou anel nenhum: quem não pediu a
   * máquina não pode ter o dedo mexido por ela.
   */
  #applyRingSwap(session: Session, character: CharacterRuntime): void {
    const ring = this.#bot?.ringSwap;
    if (ring === undefined || !character.alive) return;

    const hp = percentOf(character.health, character.maxHealth);
    const mana = percentOf(character.mana, character.maxMana);
    const wearing = character.inventory.equippedAt('finger')?.itemId === ring.itemId;

    if (wearing) {
      if (hp <= ring.removeAbove && mana >= ring.manaFloor) return;
      this.#takeOffRing(session, character, ring.restorePrevious);
      return;
    }
    if (hp >= ring.equipBelow || mana < ring.manaFloor) return;

    // Guarda o que estava no dedo ANTES de trocar: `equip` devolve a peça anterior para a
    // mochila, e sem o id guardado não há como saber qual delas era a do jogador.
    const previous = character.inventory.equippedAt('finger');
    const carried = character.inventory.backpack
      .find((item) => item.itemId === ring.itemId);
    // Não tem o anel na mochila: nada a fazer, e nada a avisar. Perder o anel é caso normal
    // (§21.3 gasta anel por tempo), e a máquina não pode virar erro por causa disso.
    if (carried === undefined) return;
    if (!character.inventory.equip(carried.instanceId, character, this.#options.items).ok) return;

    this.#ringReplaced = previous?.instanceId ?? null;
    session.record('ring-equipped', ring.itemId);
  }

  /** Tira o anel e devolve o anterior, se o jogador pediu para restaurar (§13.8). */
  #takeOffRing(session: Session, character: CharacterRuntime, restore: boolean): void {
    if (!character.inventory.unequip('finger').ok) return;
    const previous = this.#ringReplaced;
    this.#ringReplaced = null;
    session.record('ring-removed', '');
    if (!restore || previous === null) return;
    // Falhar aqui é o anel anterior ter sumido no meio da hunt. O dedo fica vazio, que é o
    // estado honesto — e é o mesmo que `restorePrevious: false` pede de propósito.
    character.inventory.equip(previous, character, this.#options.items);
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
      // que o alvo se mexeu. É a única cadência que roda mesmo sem nada a fazer — e o ritmo é
      // o do passo dado, ou o de um passo daqui quando ele ficou (FUN-119).
      const result = action.kind === 'step' ? this.#step(session, monster, action.to, subject) : null;
      const cadence = result !== null && result.ok
        ? result.durationMs
        : movementDuration(this.#world, monster, monster.position, {
          ...monster.position, z: this.#world.map.z,
        });
      session.scheduleIn(MONSTER_STEP, cadence, {
        priority: EventPriority.Movement, subject,
      });
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
      this.#playerDefender(character),
      'pve',
      this.#options.combat,
      session.rng,
    );
    const applied = character.receiveDamage(result.damage);
    recordDamage(character.contribution, subject, applied);
    // O golpe ANTES da barra (FUN-109): o número flutuante acompanha a barra caindo, não o
    // contrário. `attackerId` é o subject do monstro, o mesmo id com que ele nasceu e anda.
    session.emit({
      kind: 'creature-hit', creatureId: character.id, attackerId: subject,
      amount: applied, source: 'melee', position: this.#at(character),
    });
    this.#emitCharacterHealth(session, character);
    // HP caiu: reavalia AGORA o que está engatilhado (FUN-84). Esperar o próximo múltiplo de
    // um relógio para curar quem está caindo é a mesma perda que o golpe engatilhado da
    // FUN-68 corrigiu do outro lado — só que aqui ela custa a vida do personagem.
    this.#armBot(session, character.id);
    // E o anel defensivo (§13.8): este é o instante em que ele existe para servir.
    this.#applyRingSwap(session, character);
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

  /**
   * A vida do monstro mudou — uma vez por golpe (FUN-103).
   *
   * `creature-health` existia no protocolo sem emissor nenhum: o monstro aparecia, andava e
   * morria com a barra cheia o tempo todo, e o sintoma parecia bug do cliente.
   */
  #emitHealth(session: Session, monster: MonsterRuntime): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    session.emit({
      kind: 'creature-health-changed', creatureId: monster.subject,
      health: monster.health, maxHealth: definition?.health ?? monster.health,
    });
  }

  /**
   * A vida do PERSONAGEM mudou (FUN-109). O mesmo evento do monstro, com o id dele.
   *
   * Sai de todo lugar que escreve `character.health` OU `character.maxHealth` nesta hunt —
   * golpe, cura, poção, regeneração, level up e penalidade de morte —, e a completude é o
   * ponto: um caminho que muda a vida sem passar por aqui é a barra do jogador parando de
   * andar até a próxima reanexação, que era o defeito inteiro. O máximo conta porque
   * `retarget` (`progression.ts`) reescreve os dois de uma vez.
   */
  #emitCharacterHealth(session: Session, character: CharacterRuntime): void {
    session.emit({
      kind: 'creature-health-changed', creatureId: character.id,
      health: character.health, maxHealth: character.maxHealth,
    });
  }

  /**
   * O personagem REPÔS vida: o número que sobe, e depois a barra que sobe (FUN-109).
   *
   * Só com `amount > 0`. `castSpell` e `useSupply` devolvem o que REPÔS, não o que o efeito
   * prometia — e uma cura em quem estava cheio repôs zero. Um "+0" flutuando é ruído, e a
   * barra que não mudou não tem o que anunciar.
   */
  #emitHealed(
    session: Session, character: CharacterRuntime, amount: number,
    source: CreatureHealed['source'],
  ): void {
    if (amount <= 0) return;
    session.emit({
      kind: 'creature-healed', creatureId: character.id, amount, source,
      position: this.#at(character),
    });
    this.#emitCharacterHealth(session, character);
  }

  /**
   * Onde a criatura está, com o andar do MAPA — o mesmo `z` que `creature-appeared` e o passo
   * publicam. O monstro vive numa grade 2D e não carrega `z`; o personagem carrega, mas o mapa
   * é a única fonte de verdade sobre o andar (`WorldPoint`), e ler de dois lugares é como os
   * dois divergem.
   */
  #at(creature: { readonly position: GridPoint }): WorldPoint {
    return { x: creature.position.x, y: creature.position.y, z: this.#world.map.z };
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
      { power: this.#scaledPower(character, 'melee-hit', this.#attackPowerOf(character)),
        kind: 'melee' },
      { armor: definition.armor, dodgeChance: 0 },
      'pve',
      this.#options.combat,
      session.rng,
    );
    const applied = monster.receiveDamage(result.damage);
    recordDamage(monster.contribution, character.id, applied);
    // O número que flutua é o APLICADO — o que saiu da barra —, e sai ANTES dela (FUN-109). O
    // resolvido é o recorde do extrato, logo abaixo; mostrar 300 sobre um rato de 10 é o
    // cliente contando uma história que a barra desmente.
    session.emit({
      kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
      amount: applied, source: 'melee', position: this.#at(monster),
    });
    this.#emitHealth(session, monster);
    // O maior hit é o RESOLVIDO, não o aplicado (§16.1): um golpe de 300 num monstro com 10 de
    // vida foi um golpe de 300. Guardar o aplicado faria o recorde depender de quão morto o
    // alvo já estava, e o jogador nunca veria o número que ele de fato bateu.
    session.aggregates.bestBasicHit = Math.max(
      session.aggregates.bestBasicHit, result.damage,
    );
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
    const definitions = this.#skillsByGain[on];
    // Nenhuma skill alimentada por esta fonte: devolve o base sem tocar em nada. É o caminho
    // de um conteúdo sem skills, e ele custa uma comparação.
    if (definitions.length === 0) return base;

    let power = base;
    for (let i = 0; i < definitions.length; i += 1) {
      const definition = definitions[i] as Skill;
      if (definition.damagePerLevel === 0) continue;
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
    const definitions = this.#skillsByGain[on];
    for (let i = 0; i < definitions.length; i += 1) {
      const definition = definitions[i] as Skill;
      const gain = definition.gain;
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
      // O item cai DEPOIS do gold, na ordem da tabela — a ordem dos sorteios é contrato
      // (FUN-63), e acrescentar destino não muda sorteio nenhum.
      this.#deliverLoot(session, killer, loot.items);

      // A XP sai com o bônus de Bestiário de ANTES deste abate (DT-04): o abate que alcança um
      // marco é pago pela regra que valia quando começou, e o marco vale do próximo em diante.
      // Por isso `applyXpBonus` vem antes de `record`, e a ordem é contrato — invertida, o
      // abate 10 000 seria o único da vida do personagem a render diferente dos vizinhos. O
      // arredondamento é para baixo, e a conta é em inteiro (ver `Bestiary.applyXpBonus`).
      const experience = killer.bestiary.applyXpBonus(
        definition.experience, this.#options.bestiary,
      );
      const change = grantXp(killer, experience, this.#vocationOf(killer), this.#options.progression);
      session.aggregates.xpGained += experience;
      // Level up É evento notável, ao contrário do abate: é a única coisa que aconteceu numa
      // hunt de oito horas que o jogador quer ver ao voltar (§16.2).
      if (change !== null) {
        session.record('level-up', String(change.to));
        // E reescreve `health`/`maxHealth` pela tabela (`retarget`): a barra sai daqui como
        // de todo lugar que a escreve (FUN-109). Sem isto, a barra sobre o herói ficava com o
        // máximo velho até o próximo golpe ou regeneração — e de vida cheia a regeneração não
        // anuncia nada, então "até a reanexação".
        this.#emitCharacterHealth(session, killer);
      }
      // O abate conta no Bestiário DENTRO deste `if`, e não fora (DT-03, §18.6): stamina zero
      // não conta abate, pela MESMA condição que não paga XP nem loot. Duas condições
      // divergiriam na primeira mudança em uma delas. E fechar um marco é evento notável, como
      // o level up: acontece cinco vezes por monstro na vida inteira do personagem.
      const reached = killer.bestiary.record(monster.monsterId, this.#options.bestiary);
      if (reached.milestoneReached !== null) {
        session.record('bestiary-milestone', `${monster.monsterId}/${reached.milestoneReached}`);
      }
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
    // Um emit aqui, e não uma varredura de `#monsters` por ciclo no hospedeiro: com 5.000
    // instâncias, quem conta o custo é a fila, não o laço de quem olha (FUN-103).
    session.emit({ kind: 'creature-vanished', creatureId: subject });
  }

  /**
   * Entrega o que caiu: mochila primeiro, Caixa de Loot da Sessão para o que não couber
   * (§22.2, §21.6, FUN-88).
   *
   * **O id da instância é DETERMINÍSTICO** — `sessionId:n` —, e isso é o que torna a inserção
   * idempotente: um extrato reprocessado insere a mesma chave primária e não faz nada. É a
   * mesma propriedade que a `UNIQUE (session_id, seq)` dá ao ledger (invariante 10), obtida do
   * mesmo jeito: identidade previsível em vez de conferência.
   *
   * Nada aqui escreve banco. O `sim` não faz I/O (invariante 1): o que ele faz é registrar
   * onde cada coisa ficou, e o extrato leva.
   */
  #deliverLoot(
    session: Session, character: CharacterRuntime, items: readonly LootItem[],
  ): void {
    for (const rolled of items) {
      // O catálogo é conferido ANTES de gastar um id. `buildContent` recusa loot de item
      // inexistente no boot, então isto só acontece com o conteúdo mudando sob uma sessão em
      // voo — e aí o certo é não entregar nada e não queimar identidade por um item que não
      // vai existir.
      if (this.#options.items.get(rolled.itemId) === undefined) continue;

      const carried: CarriedItem = {
        instanceId: `${session.id}:${character.lootSeq++}`,
        itemId: rolled.itemId,
        quantity: rolled.quantity,
      };
      // Conta no ANALISADOR aconteça o que acontecer com o destino: o item caiu, e é isso que
      // o §16.1 chama de loot. Contar só o que coube faria a mochila cheia parecer hunt ruim.
      session.aggregates.itemsLooted += carried.quantity;

      if (character.inventory.add(carried, this.#options.items, character).ok) continue;

      // Não coube: vai para a caixa. Ela é da SESSÃO — encerrar começa o relógio de 30
      // minutos —, e por isso o item ainda não é uma instância no banco: expirar precisa
      // significar que ele nunca existiu, não que existe e ninguém consegue ver.
      character.lootBox.push(carried);
      if (this.#warnedFullBackpack) continue;
      this.#warnedFullBackpack = true;
      // UMA linha no extrato, como o aviso de stamina. Uma por item encheria a lista curta da
      // tela de retorno até ela deixar de ser lista — e o que o jogador precisa saber é que a
      // mochila encheu, não qual das trinta flechas ficou de fora.
      session.record('backpack-full', character.id);
    }
  }

  #vocationOf(character: CharacterRuntime): Vocation | null {
    if (character.vocationId === null) return null;
    // Vocação que saiu do conteúdo cai para a tabela base em vez de derrubar a hunt: perder
    // stats é ruim, perder a sessão inteira de quem estava caçando é pior.
    return this.#options.vocations.get(character.vocationId) ?? null;
  }

  /**
   * O ataque da ARMA equipada, ou o do desarmado (FUN-82).
   *
   * `combat.player.attackPower` deixou de ser "o ataque do personagem" e passou a ser o do
   * personagem SEM arma — o fallback, e ele é conteúdo. Um zero em código no lugar dele faria
   * todo personagem novo não machucar nada, e sem arma é como todo personagem começa.
   */
  #attackPowerOf(character: CharacterRuntime): number {
    return character.inventory.weaponAttack(this.#options.items)
      ?? this.#options.player.attackPower;
  }

  /**
   * A defesa do personagem: a armadura do CONTEÚDO mais a do que ele veste (FUN-82).
   *
   * Soma, e não substituição: `combat.player.armor` é a resistência do corpo, e a peça vestida
   * acrescenta. Substituir faria vestir a primeira armadura deixar o personagem mais frágil se
   * ela valesse menos que o número base.
   *
   * Recebe o personagem porque a armadura passou a depender de quem é — antes era constante.
   */
  #playerDefender(character: CharacterRuntime): Defender {
    return {
      armor: this.#options.player.armor + character.inventory.armor(this.#options.items),
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
 * Percentual inteiro, com o zero protegido — `maxMana` zero é o personagem que ainda não tem
 * mana, não uma divisão por zero.
 *
 * Mesma conta que `bot.ts` faz para as condições, e é de propósito: os dois lados do bot
 * comparam percentual, e um deles usando outra fórmula faria "abaixo de 30%" querer dizer duas
 * coisas diferentes na mesma configuração.
 */
function percentOf(current: number, max: number): number {
  if (max <= 0) return 0;
  return (current / max) * 100;
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
    items: content.items,
    // Opcional no conteúdo, opcional aqui — e a chave só existe quando há valor, por causa do
    // `exactOptionalPropertyTypes`.
    ...(content.bestiary === undefined ? {} : { bestiary: content.bestiary }),
    targetSearchRadius: content.bot.targetSearchRadius,
    spells: content.spells,
    supplies: content.supplies,
    player: { ...content.combat.player },
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
