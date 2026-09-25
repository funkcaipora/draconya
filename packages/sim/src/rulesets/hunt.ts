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

import {
  BASIC_ABILITY_ID, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, ITEM_SLOTS, isBlocked,
  migrateBotConfigV1,
} from '@draconya/content';
import type {
  AmmoFamily, Ammunition, BotAction, BotActionV2, BotConfig, BotConfigV2, BotExitRule, Combat,
  CompiledWeaponFamily, Content, DamageType, FieldSpec, Hunt, HuntDifficulty, Item, ItemSlot,
  Monster, MonsterAbility, PartyConfig, Progression,
  ResolvedWeapon, Route, Skill, Spell, SpellArea, SpawnPoint, Stamina, Supply, Tilemap, Vocation,
  WeaponFamily, WeaponProfile,
} from '@draconya/content';
import { CharacterRuntime } from '../character.js';
import { areaTiles, directionOf, isSelfOrigin, tileKey } from '../area.js';
import {
  NOT_IN_CATALOG, balanceOf, castSpell, executeHealing, groupCooldownKey,
  ownPurse, spellCooldownKey, supplyCooldownKey, useSupply,
} from '../casting.js';
import type { CastRefused, CastResult, Purse, SpellAim, SpellScaling, SpellTarget } from '../casting.js';
import type { ConditionState } from '../conditions.js';
import { conditionFromSpec, sameTick, specTickIntervalMs, tickOf } from '../conditions.js';
import type { NormalizedTick } from '../conditions.js';
import { Fields } from '../fields.js';
import type { TileFieldState } from '../fields.js';
import type { CreatureHealed, PartyBagChanged, SpellCastTarget } from '../combat-events.js';
import { resolveDamage } from '../combat/damage.js';
import type { DamageOutcome, Defender } from '../combat/damage.js';
import { applyDamageOutcome } from '../combat/outcome.js';
import type { DefenseSource } from '../combat/defense.js';
import { resolveWeaponPower } from '../combat/weapon-power.js';
import { forgetActor, recordDamage, resolveDeath } from '../death.js';
import type { KillCredit, Victim } from '../death.js';
import type { BestiaryConfig } from '../bestiary.js';
import { Spawner } from '../hunt/spawner.js';
import type { SpawnerState } from '../hunt/spawner.js';
import { rollLoot } from '../loot.js';
import {
  autoSellLimit, bagValue, reserveProportionally, settleEntries, shareCostsOf, splitEqually,
  splitLootOf, uniqueVocations, xpShare,
} from '../party.js';
import type { MemberCapacity, PartyBagState } from '../party.js';
import type { LootItem } from '../loot.js';
import type { CarriedItem, ContainerRules, EquipmentObserver, Wearer } from '../inventory.js';
import { compileBot, percentOf } from '../bot.js';
import type { BotActuator, BotView, CompiledBot, CompiledSlot, CooldownOfAction } from '../bot.js';
import { compileAutomations } from '../automation.js';
import type { AutomationActuator, CompiledAutomations } from '../automation.js';
import {
  MonsterRuntime, chooseTarget, decideMonsterAction, monsterSubject,
} from '../monster/monster.js';
import type { MonsterState, Prey } from '../monster/monster.js';
import { abilityTargets, abilityTiles, isMeleeAbility } from '../monster/ability.js';
import type { Blocked, GridPoint } from '../monster/step.js';
import { distance, fleeStep, greedyStep } from '../monster/step.js';
import { DEFAULT_TARGETING, countAreaTargets, countTargets, selectTarget } from '../targeting.js';
import type { Targeting } from '../targeting.js';
import { applyDeathPenalty, grantXp, statsForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { containerRulesFor } from '../inventory.js';
import { TileOccupancy, canOccupy, move, movementDuration, place, placeNear } from '../movement.js';
import type { Movable, MoveResult, WorldPoint } from '../movement.js';
import type { RouteState } from '../route/walker.js';
import { EventPriority } from '../schedule.js';
import type { ScheduledEvent } from '../schedule.js';
import { powerMultiplier } from '../skills.js';
import { drainStamina, isExhausted } from '../stamina.js';
import { RouteWalker } from '../route/walker.js';
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
/**
 * Uma ability DECLARADA do monstro (CMB-06). O subject é derivado (`m:<id>:<abilityId>`), e é
 * ele que a morte cancela sem varrer a fila — `#onMonsterDied` conhece os ids pelo conteúdo.
 *
 * A básica legada continua em `MONSTER_ATTACK` com subject `m:<id>`: um snapshot de um nó
 * anterior traz esses eventos, e tratá-los como ability básica é o que mantém a retomada
 * compatível durante o deploy em rolagem.
 */
const MONSTER_ABILITY = 'monster-ability';
const monsterAbilitySubject = (id: number, abilityId: string): string =>
  `${monsterSubject(id)}:${abilityId}`;
const HEALTH_REGEN = 'health-regen';
const MANA_REGEN = 'mana-regen';
const SPAWN = 'spawn';
/** O cadáver apodreceu (FUN-123): sai do chão. */
const CORPSE = 'corpse';
const EXIT_RULES = 'exit-rules';
const EXIT_COUNTDOWN = 'exit-countdown';
/**
 * O vencimento da votação de encerrar a hunt para todos (#432, ADR 0032 d.14). É um evento da
 * fila no instante exato em que vence — nunca um contador por tick (invariante 2). O subject é
 * fixo porque só existe uma votação por vez: re-propor cancela o vencimento anterior.
 */
const END_VOTE_EXPIRE = 'end-vote-expire';
const END_VOTE_SUBJECT = 'end-vote';
/** A janela de aprovação, em tempo LÓGICO (ADR 0032 d.14). Conteúdo pode mudar sem ADR. */
export const END_VOTE_WINDOW_MS = 60_000;

/**
 * O vencimento de um item equipado por TEMPO (ADR 0032 d.8): o anel que gasta por duração. É
 * um evento da fila, agendado no equip e cancelado no desequip (invariante 2) — nunca um
 * `remainingMs -= dtMs`. O subject é `<characterId>:<slot>`, o que permite cancelar por slot.
 */
const EQUIP_EXPIRE = 'equip-expire';
function equipExpirySubject(characterId: string, slot: ItemSlot): string {
  return `${characterId}:${slot}`;
}

/**
 * O ciclo das automações do catálogo (AB-08, ADR 0032 d.9). Evento PERIÓDICO que se reagenda
 * (como `monster-step`), nunca avaliação por tick: a 1 Hz desanexada o resultado é o mesmo da
 * 10 Hz anexada (invariante 2, ADR 0020). O subject é o personagem; quem não habilitou
 * automação nenhuma não agenda nada.
 */
const AUTOMATION = 'bot-automation';
const AUTOMATION_INTERVAL_MS = 1_000;

type ExitReason = 'manual-exit' | 'exit-rule';
/**
 * As condições (#155, CMB-07): o vencimento e o tique periódico. Eventos da fila (invariante 2),
 * nunca acumulador. `subject` é `<targetId>/<key>`: um cancelamento por condição, sem varrer a
 * fila. O alvo pode ser personagem ou monstro desde o CMB-07 — o id do monstro é `m:<id>`.
 */
const CONDITION_EXPIRE = 'condition-expire';
const CONDITION_TICK = 'condition-tick';
const conditionSubject = (targetId: string, key: string): string => `${targetId}/${key}`;
/**
 * Os campos de tile (CMB-07): um evento POR CAMPO. O tique aplica a condição a quem pisa nos
 * tiles; o vencimento tira o campo. `subject` é `f:<id>`.
 */
const FIELD_TICK = 'field-tick';
const FIELD_EXPIRE = 'field-expire';
const fieldSubject = (fieldId: string): string => `f:${fieldId}`;
/**
 * No MESMO instante, o vencimento roda ANTES do tique — de condição e de campo. É a ordem
 * documentada e testada: o tique do instante de expiração não acontece. A prioridade é explícita
 * (e não a sequência de agendamento) porque relançar reagenda o vencimento depois do tique, e a
 * ordem não pode depender de quem foi agendado por último.
 */
const EXPIRE_PRIORITY = EventPriority.Housekeeping;
const TICK_PRIORITY = EventPriority.Housekeeping + 1;
/**
 * Um evento POR GRUPO de cooldown do conteúdo (AB-07, ADR 0032 d.2). Não existe prioridade
 * global entre grupos: uma cura que executa não atrasa o ataque, porque são vencimentos
 * independentes na mesma fila. Dentro de um grupo, a prioridade é a ordem do slot (RP-002).
 */
const botEvent = (group: string): string => `bot:${group}`;

/** O prefixo que separa o evento de grupo do resto dos eventos do ruleset. */
const BOT_GROUP_PREFIX = 'bot:';

/**
 * O tipo de entrada da configuração do bot (DT-02): v1 ou v2.
 *
 * A v2 é o vocabulário alvo; a v1 continua aceita porque o carregamento só liga a migração no
 * AB-09 (#424) — até lá, `server`/`tools` entregam a config que o jogador salvou, e
 * `migrateBotConfigV1` a normaliza no boundary. A união some no AB-09.
 */
type BotConfigInput = BotConfigV2 | BotConfig;

/**
 * Por que o disparo manual de um slot não aconteceu (AB-09, ADR 0032 d.3). Tipada porque o
 * jogador merece saber qual foi — e porque o host traduz cada uma para o tooltip do slot.
 *
 * `not-in-catalog` cobre magia/item inexistente e os requisitos que o manual não passa
 * (level, vocação): "essa ação não sai agora". O `magic-level-too-low` tem motivo PRÓPRIO
 * desde a M24-12 (RF-02): a UI precisa dizer POR QUE a runa não rodou, e engolir o requisito
 * de magic level no genérico fazia o jogador procurar o problema no saldo e no alvo.
 */
export type SlotRefusal =
  | 'empty-slot' | 'wrong-set' | 'disabled' | 'not-in-catalog' | 'magic-level-too-low'
  | 'not-enough-mana' | 'not-enough-gold' | 'not-enough-item' | 'no-target' | 'out-of-range'
  | 'on-cooldown' | 'group-cooldown';

/** O resultado do disparo manual: sucesso, ou recusa tipada com o prazo quando é cooldown. */
export type SlotOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SlotRefusal; readonly retryInMs: number };

/**
 * O estado de UM slot do conjunto ativo (AB-09, UC-BAR-003). É APRESENTAÇÃO: espelha a mesma
 * elegibilidade de `#perform` sem mutar nada, e a contagem de consumível NÃO entra aqui — ela é
 * do `inventory` (invariante 4).
 */
export interface SlotState {
  readonly set: number;
  readonly slot: number;
  readonly state: 'ready' | 'cooldown' | 'blocked' | 'empty';
  readonly remainingMs: number;
  readonly reason?: SlotRefusal;
}

/**
 * Traduz a recusa do atuador para a recusa do slot. É a salvaguarda de DT-08: `slotStates`
 * calcula o mesmo motivo por outro caminho, e o teste prende que os dois coincidem.
 */
function refusalOf(result: CastRefused): SlotRefusal {
  switch (result.reason) {
    case 'not-in-catalog':
    case 'level-too-low':
    case 'wrong-vocation':
      return 'not-in-catalog';
    // Motivo PRÓPRIO (RF-02): o slot-state precisa distinguir o requisito de magic level do
    // genérico, senão o cliente não consegue explicar por que a runa não rodou.
    case 'magic-level-too-low': return 'magic-level-too-low';
    case 'on-cooldown': return 'on-cooldown';
    case 'group-cooldown': return 'group-cooldown';
    case 'no-target': return 'no-target';
    case 'out-of-range': return 'out-of-range';
    case 'not-enough-mana': return 'not-enough-mana';
    // O suprimento v2 é ABSTRATO: o "estoque" é o saldo, e a falta dele tem motivo próprio —
    // `not-enough-item` fica reservado ao consumível FÍSICO (a carga de bênção de M22).
    case 'not-enough-gold': return 'not-enough-gold';
  }
}

/** A recusa do manual, montada num lugar só. */
function refuse(reason: SlotRefusal, retryInMs: number): SlotOutcome {
  return { ok: false, reason, retryInMs };
}

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
/** Até onde o segundo participante procura tile livre ao entrar (#203): o anel de `placeNear`. */
const ENTRY_RADIUS = 3;

function targetingOf(runner: Runner | undefined): Targeting {
  return runner?.bot?.targeting ?? DEFAULT_TARGETING;
}

function runnerState(runner: Runner): RunnerState {
  // Só os grupos do CONTEÚDO que estão AGENDADOS entram no snapshot. As chaves são strings, e o
  // motor v2 ignora categorias v1 que um snapshot antigo traga (seção 7 do AB-07).
  const botScheduled: string[] = [];
  if (runner.bot !== undefined) {
    for (const group of runner.bot.groups.keys()) {
      if (runner.botReady[group] === false) botScheduled.push(group);
    }
  }
  return {
    route: runner.walker.getState(),
    botScheduled,
    luring: runner.running,
    ringReplaced: runner.ringReplaced,
    playerAttackReady: runner.playerAttackReady,
    warnedExhausted: runner.warnedExhausted,
    warnedFullBackpack: runner.warnedFullBackpack,
    warnedNoGold: runner.warnedNoGold,
    ...(runner.automationWarned.size === 0
      ? {}
      : { automationWarned: Object.fromEntries(runner.automationWarned) }),
    ...(runner.attackTarget === null && runner.botCandidate === null
      ? {}
      : { chosenTarget: runner.attackTarget ?? runner.botCandidate }),
    ...(runner.attackTarget === null || !runner.attackTargetPinned
      ? {}
      : { chosenTargetPinned: true }),
    ...(runner.botConfig === undefined ? {} : { botConfig: runner.botConfig }),
    ...(runner.pendingExit === null ? {} : { pendingExit: runner.pendingExit }),
    ...(runner.followInterrupted ? { followInterrupted: true } : {}),
    ...(runner.followTargetId === undefined ? {} : { followTargetId: runner.followTargetId }),
    ...(runner.followReason === undefined ? {} : { followReason: runner.followReason }),
  };
}

const NO_TILES: readonly WorldPoint[] = [];
const NO_MEMBERS: readonly CharacterRuntime[] = [];
const NO_SPELL_TARGETS: readonly SpellCastTarget[] = [];
/** Nenhum candidato de party para a regra (alvo inválido, fora de alcance ou efeito self-only). */
const NO_CANDIDATES: readonly CharacterRuntime[] = [];

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
  /** O tipo do golpe desarmado (CMB-03). Vem de `combat.player.damageType`. */
  readonly damageType: DamageType;
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
export function compileExitRules(
  rules: readonly BotExitRule[],
  items: ReadonlyMap<string, Item>,
): readonly HuntExitRule[] {
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
          // Não é predicado periódico (#193): dispara no `onLeave` de OUTRO membro — sair ou
          // morrer, os dois casos que o §13.9 junta —, por `#onMemberLost`, pelo id. A view
          // de cada runner leva só ele, então aqui não há o que olhar; e numa hunt de um não
          // há de quem sair, por construção.
          when: () => false,
        };
      case 'out-of-capacity':
        return {
          id: 'out-of-capacity',
          when(view) {
            const self = view.participants[0];
            if (self === undefined || !self.alive) return false;
            if (self.capacity <= 0) return false;
            return self.inventory.weight(items) >= self.capacity;
          },
        };
    }
  });
}

/**
 * A configuração tem algum slot do conjunto ativo com alvo != self? É a pergunta que
 * `#armHealersOf` faz por participante (só cura/mana aceitam amigo; `validateBotConfigV2` já
 * recusou qualquer outro alvo, e o parse preenche `self` quando ausente).
 */
function hasNonSelfHealRule(config: BotConfigV2): boolean {
  const active = config.sets[config.activeSet];
  if (active === undefined) return false;
  return active.slots.some((slot) => slot !== null && (slot.target?.kind ?? 'self') !== 'self');
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
  /**
   * A tabela da party (#190, ADR 0027). Sempre presente: solo é party de um, e `xpShare`
   * devolve a XP inteira sem ler a tabela.
   */
  readonly party: PartyConfig;
  readonly vocations: ReadonlyMap<string, Vocation>;
  /** Catálogo de magias (FUN-74). Vazio é uma hunt em que nenhuma magia sai. */
  readonly spells: ReadonlyMap<string, Spell>;
  /** Catálogo de supplies (FUN-77). Vazio é uma hunt sem poção. */
  readonly supplies: ReadonlyMap<string, Supply>;
  /**
   * Catálogo de munição (ADR 0026 d.3). A munição é ABSTRATA — uma seleção por família que
   * debita gold no tiro; vazio é uma hunt em que arco e besta não atiram.
   */
  readonly ammunition: ReadonlyMap<string, Ammunition>;
  /** Skills que sobem por uso (FUN-75). Vazio é uma hunt em que nada sobe por fazer. */
  readonly skills: ReadonlyMap<string, Skill>;
  /** Catálogo de itens (FUN-76). O que a arma equipada bate sai daqui. */
  readonly items: ReadonlyMap<string, Item>;
  /**
   * As famílias de arma (CMB-05): a família do perfil aponta a skill e a prática, e a fórmula
   * já vem compilada. Indexada no boot — nenhuma varredura de catálogo por golpe.
   */
  readonly weaponFamilies: ReadonlyMap<WeaponFamily, CompiledWeaponFamily>;
  /** O perfil do golpe desarmado (CMB-05): o fallback de quem não tem arma. */
  readonly unarmed: WeaponProfile;
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
   * **Sem configuração não há evento nenhum agendado** — o custo de um evento por grupo só
   * existe para quem configurou.
   */
  readonly botConfig?: BotConfigInput;
  /**
   * Substitui o atuador embutido (FUN-74/FUN-77).
   *
   * O padrão é a própria hunt: magia e supply são executados aqui, onde estão o alvo, o RNG da
   * sessão e o relógio lógico. Este campo sobrou como costura de teste — e para o dia em que
   * um ruleset quiser outra política sem reescrever o resto.
   */
  readonly actuator?: BotActuator;
  /**
   * A configuração do bot de CADA participante, por id (#203, ADR 0027). `botConfig` continua
   * sendo a do primeiro a entrar — o caminho solo; quem entra com id aqui usa a sua.
   */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191, ADR 0027). Ausente é solo. */
  readonly partyOptions?: PartyOptionsInput;
  /** Cooldown de FALLBACK de um grupo sem livro próprio (§13.5: 1 s). Parâmetro, não constante. */
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

/** Um cadáver no chão (FUN-123): de que monstro, onde. O prazo dele é o evento `CORPSE` na fila. */
export interface CorpseState {
  readonly id: number;
  readonly monsterId: string;
  readonly position: WorldPoint;
}

/**
 * Quem pode carregar uma condição (CMB-07): personagem ou monstro. Os dois têm `conditions`,
 * posição e vida; o tique de dano de um DOT entra no mesmo pipeline para os dois.
 */
type ConditionTarget = CharacterRuntime | MonsterRuntime;

/** Como a party divide loot e custo (ADR 0027 decisão 5). */
export type PartyMode = 'split' | 'shared';

/**
 * Os dois eixos do líder, mais a config de loot (§4, §5, ADR 0035 decisão 1).
 *
 * Vive ao lado dos campos achatados de `PartyOptions` para quem preferir o bloco — a migração
 * de `{ settings }` preenche os mesmos eixos. `collect`/`autoSell` só são lidos por `partySummary`
 * nesta issue; o filtro e a venda de fato são do #395.
 */
export interface PartySettings {
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  /** `null` = coletar tudo. Filtro de fato é do #395. */
  readonly collect: readonly string[] | null;
  /** Ordem configurada; só os `limit` primeiros valem (aplicação de fato é do #395). */
  readonly autoSell: readonly string[];
}

/**
 * A party desta instância (#191). Ausente é solo. MUTÁVEL desde o #394 — antes era fixada na
 * sessão; o líder muda por `configureParty`.
 *
 * `mode` continua como espelho LEGADO (o `host` o lê até o #400): nasce da combinação dos dois
 * eixos e não é reescrito por `configureParty` — quem manda é `shareCosts`/`splitLoot`.
 */
export interface PartyOptions {
  leaderId: string;
  readonly mode: PartyMode;
  shareCosts: boolean;
  splitLoot: boolean;
  collect: readonly string[] | null;
  autoSell: readonly string[];
  premiumByCharacter: Record<string, boolean>;
}

/**
 * O que `HuntRulesetOptions`/`HuntSessionOptions`/`HuntRulesetState.partyOptions` aceitam: o
 * formato novo (`PartyOptions`, achatado), o bloco `{ settings }` do desenho, OU o legado que
 * `packages/server` ainda constrói com `mode` até o #400 modernizar o ticket.
 */
export type PartyOptionsInput =
  | PartyOptions
  | {
      readonly leaderId: string;
      readonly settings: PartySettings;
      readonly premiumByCharacter?: Readonly<Record<string, boolean>>;
    }
  | {
      readonly leaderId: string;
      readonly mode: PartyMode;
      readonly shareCosts?: boolean;
      readonly splitLoot?: boolean;
      readonly premiumByCharacter?: Readonly<Record<string, boolean>>;
    };

export type ConfigurePartyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-leader' }
  | { readonly ok: false; readonly reason: 'unknown-item'; readonly itemId: string }
  | { readonly ok: false; readonly reason: 'unsellable-item'; readonly itemId: string };

export interface PartySettingsPatch {
  readonly shareCosts?: boolean;
  readonly splitLoot?: boolean;
  readonly collect?: readonly string[] | null;
  readonly autoSell?: readonly string[];
}

/**
 * A recusa da votação de encerrar (#432). `not-leader` cobre solo e quem não lidera — como
 * `configureParty`, uma sessão sem party não tem líder para propor. `no-proposal` é aprovar ou
 * recusar sem votação aberta; `not-member` é um id que não está presente.
 */
export type PartyEndVoteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-leader' | 'not-member' | 'no-proposal' };

/** O bloco PARTY dos Detalhes da Caçada (§32, ADR 0035 decisão 11). */
export interface PartySummary {
  readonly leaderId: string;
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  readonly members: readonly string[];
  readonly uniqueVocations: number;
  readonly xpPoolPercent: number;
  readonly bagValue: number;
  readonly bagWeight: number;
  readonly autoSell: { readonly configured: number; readonly limit: number };
}

/** Migra o formato legado (`mode` + eixos opcionais) para os campos do `PartyOptions`. */
function partySettingsFromLegacy(input: {
  readonly mode: PartyMode;
  readonly shareCosts?: boolean;
  readonly splitLoot?: boolean;
}): PartySettings {
  return {
    shareCosts: shareCostsOf(input),
    splitLoot: splitLootOf(input),
    collect: null,
    autoSell: [],
  };
}

/**
 * Uma função só migra as duas entradas (construção E snapshot): o formato novo achatado, o
 * bloco `{ settings }` ou o legado `{ mode }`. Sem bump de `SNAPSHOT_FORMAT_VERSION`.
 */
function normalizePartyOptions(input: PartyOptionsInput | undefined): PartyOptions | undefined {
  if (input === undefined) return undefined;
  const premiumByCharacter = { ...(input.premiumByCharacter ?? {}) };
  const settings = (input as { readonly settings?: PartySettings }).settings;
  if (settings !== undefined) {
    return {
      leaderId: input.leaderId,
      mode: settings.shareCosts && settings.splitLoot ? 'shared' : 'split',
      shareCosts: settings.shareCosts,
      splitLoot: settings.splitLoot,
      collect: settings.collect,
      autoSell: [...settings.autoSell],
      premiumByCharacter,
    };
  }
  const flat = input as Partial<PartyOptions>;
  if (flat.collect !== undefined || flat.autoSell !== undefined) {
    // Já é o `PartyOptions` achatado — cópia, para o snapshot não compartilhar referência.
    return {
      leaderId: input.leaderId,
      mode: (input as { readonly mode: PartyMode }).mode,
      shareCosts: flat.shareCosts === true,
      splitLoot: flat.splitLoot === true,
      collect: flat.collect ?? null,
      autoSell: [...(flat.autoSell ?? [])],
      premiumByCharacter,
    };
  }
  const legacy = input as {
    readonly leaderId: string;
    readonly mode: PartyMode;
    readonly shareCosts?: boolean;
    readonly splitLoot?: boolean;
  };
  const migrated = partySettingsFromLegacy(legacy);
  return {
    leaderId: legacy.leaderId,
    mode: legacy.mode,
    shareCosts: migrated.shareCosts,
    splitLoot: migrated.splitLoot,
    collect: migrated.collect,
    autoSell: [...migrated.autoSell],
    premiumByCharacter,
  };
}

/**
 * Nenhuma venda automática efetiva. Fica fora das opções porque o conjunto é derivado do
 * líder a cada abate; criá-lo vazio é o que evita alocar um `Set` por item de quem não vende.
 */
const EMPTY_AUTO_SELL: ReadonlySet<string> = new Set();

/**
 * O formato ANTIGO da bolsa no snapshot (`gold: number`, `items: CarriedItem[]`), lido só
 * pelo `restore` para migrar uma sessão em voo para entradas com `eligible: []` — o sentinel
 * de "presentes no settlement" (D5, sem bump de `SNAPSHOT_FORMAT_VERSION`).
 */
interface LegacyPartyBagState {
  readonly gold: number;
  readonly items: readonly CarriedItem[];
  readonly capacity: number;
}

const isLegacyBag = (bag: unknown): bag is LegacyPartyBagState =>
  typeof (bag as LegacyPartyBagState).gold === 'number';

export interface HuntRulesetState {
  readonly huntId: string;
  readonly difficulty: HuntDifficultyName;
  readonly route: RouteState;
  readonly spawner: SpawnerState;
  readonly monsters: readonly MonsterState[];
  readonly nextCreatureId: number;
  /** Os cadáveres no chão (FUN-123). Ausente é nenhum: snapshot anterior. */
  readonly corpses?: readonly CorpseState[];
  /** O próximo id de item de chão. Ausente é `1`: snapshot anterior à FUN-123. */
  readonly nextGroundItemId?: number;
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
   * Quais GRUPOS do bot estão AGENDADOS (AB-07).
   *
   * Precisa entrar no snapshot pela mesma razão que `playerAttackReady`: o evento pendente do
   * grupo está na fila serializada, e restaurar como "engatilhado" faria o próximo `#armBot`
   * agendar um segundo — ação dobrada, que é a invariante que este par protege.
   *
   * As chaves são os grupos do CONTEÚDO (ou as categorias v1 de um snapshot anterior, que o
   * motor v2 ignora). Ausente é "nenhum agendado".
   */
  readonly botScheduled?: readonly string[];
  /** Ver `HuntRuleset.#running`. Ausente é `true`: o lure começa juntando (FUN-87). */
  readonly luring?: boolean;
  /** Ver `HuntRuleset.#ringReplaced`. Ausente é `null`: o dedo estava vazio. */
  readonly ringReplaced?: string | null;
  /**
   * O estado por PARTICIPANTE (#203, ADR 0027): caminhante, bot, lure, anel, golpe engatilhado
   * e avisos de cada um. Os campos soltos acima continuam escritos — com o do primeiro — e são
   * lidos quando esta chave falta: é o snapshot anterior, de um dono só, sem bump.
   */
  readonly runners?: Readonly<Record<string, RunnerState>>;
  /** A party (#191): achatada no formato novo, ou o legado `{mode}` de um snapshot anterior. */
  readonly partyOptions?: PartyOptionsInput;
  /** A bolsa do modo compartilhado (#192). Só existe com `partyOptions.splitLoot`. */
  readonly partyBag?: PartyBagState;
  /**
   * A votação de encerrar em curso (#432). Opcional: ausente é nenhuma votação, o estado de um
   * snapshot anterior. O vencimento já vem na fila serializada; isto preserva quem já aprovou
   * para uma sessão retomada no meio da janela não perder a contagem.
   */
  readonly endVote?: { readonly proposedAtMs: number; readonly approved: readonly string[] };
  /**
   * Os campos de tile ativos (CMB-07). Opcional: ausente é nenhum campo, que é o estado de um
   * snapshot anterior a esta issue. Os eventos de tique e vencimento já vêm na fila serializada.
   */
  readonly fields?: readonly TileFieldState[];
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
   *
   * O motor normaliza para v2 ao recompilar (DT-02): a v1 legível no snapshot não perde
   * configuração.
   */
  readonly botConfig?: BotConfigV2;
}

/**
 * O que é de UM participante dentro da hunt (#203). Antes do M13 tudo isto era campo da
 * classe, e a hunt recusava o segundo personagem; agora é um `Runner` por id, e os eventos —
 * que já carregavam `subject` — encontram o seu.
 */
interface Runner {
  walker: RouteWalker;
  /** O bot vigente, MUTÁVEL: o jogador troca no meio da hunt e vale na hora (FUN-81). */
  bot: CompiledBot | undefined;
  /** A configuração v2 correspondente, para o snapshot. Anda junto com `bot`, sempre. */
  botConfig: BotConfigV2 | undefined;
  /**
   * As automações do catálogo, compiladas (AB-08). Derivadas de `botConfig`, como o `bot`:
   * `[]` é nenhuma, e é o que faz um runner sem automação habilitada não agendar o evento.
   */
  automations: CompiledAutomations;
  /**
   * O atuador das automações, montado UMA vez por runner (#420).
   *
   * Antes `#onAutomation` reconstruía o objeto com ~10 closures a cada ciclo (1 Hz mais cada
   * golpe recebido); com 5.000 hunts isso é o coletor rodando o tempo todo. `undefined` só no
   * runner descartável de `getState` sem participantes — não há automação a executar.
   */
  actuator: AutomationActuator | undefined;
  /**
   * Por automação (chave = `model`), a última chave `reason:itemId` que já foi registrada como
   * `automation-blocked`. Só a TRANSIÇÃO registra: uma automação bloqueada por 8 h vale UMA
   * linha no extrato, não 28.800. Ver `RunnerState.automationWarned`.
   */
  readonly automationWarned: Map<string, string>;
  exitRules: readonly HuntExitRule[];
  pendingExit: ExitReason | null;
  /** Por GRUPO: `true` = ENGATILHADO (nenhum evento pendente), `false` = agendado. */
  readonly botReady: Record<string, boolean>;
  /** O golpe está engatilhado? Ver `#onPlayerAttack`. */
  playerAttackReady: boolean;
  /**
   * O alvo de ATAQUE explícito, por subject do monstro (`m:<id>`): o override do jogador
   * (AB-09, ADR 0032 d.5) e o alvo que o bot decide seguir (#480). É EXCLUSIVO — quem mandou
   * seguir um não quer bater em outro no caminho —, e `setAttackTarget` é a única porta de
   * escrita, o que põe jogador e bot no mesmo pipeline (#470).
   *
   * Separado de `botCandidate` (#470): antes os dois dividiam `chosenTarget` mais um booleano
   * `chosenTargetPinned`, e a apresentação usava o alvo de ATAQUE — que é recortado pelo
   * alcance da arma e fazia o alvo sumir da tela fora do corpo a corpo.
   */
  attackTarget: string | null;
  /**
   * O alvo de ataque foi PINADO pelo jogador (AB-09) ou apenas eleito pelo bot (#480)?
   *
   * O bot entra pela MESMA porta (`setAttackTarget`), mas com `pinned: false`: o alvo dele é
   * uma eleição da política, e fora do alcance a política reassume — só o clique do jogador é
   * exclusivo (ADR 0032 d.5). Sem esta distinção, o alvo que o auto-target guarda na tela
   * travaria o corpo a corpo, que é justamente o que a #444 não pode regredir.
   */
  attackTargetPinned: boolean;
  /**
   * O candidato do AUTO-TARGET (#444): o melhor monstro na tela, escolhido pela política,
   * quando não há alvo de ataque válido. É só a mira corrente — sai do alcance e a política
   * reassume —, e `selectedTargetOf` o expõe para a apresentação independentemente do alcance
   * da arma (RF-05).
   */
  botCandidate: string | null;
  /** Está CORRENDO para juntar monstros (§13.7)? Começa juntando. */
  running: boolean;
  /** Que anel estava no dedo quando a máquina equipou o dela (§13.8). `null` = vazio. */
  ringReplaced: string | null;
  warnedExhausted: boolean;
  warnedFullBackpack: boolean;
  warnedNoGold: boolean;
  /** Já reportamos `active:false` para este follow e ainda não retomou (§D10, "uma vez"). */
  followInterrupted: boolean;
  /**
   * O alvo CONFIGURADO do follow, guardado no último `#reportFollow` (#401). Existe para o
   * `followStateOf` devolver a verdade ATUAL a quem reconecta: o evento `follow-state` só é
   * emitido na TRANSIÇÃO, e `kind: 'leader'` resolve o líder a cada vencimento — guardar o id
   * aqui é o que dispensa uma segunda resolução de liderança no hospedeiro.
   */
  followTargetId: string | undefined;
  /** Por que o follow está interrompido (#401): o `reason` do último `follow-state` inativo. */
  followReason: 'dead' | 'left' | 'unreachable' | undefined;
}

/**
 * A reserva morde a mochila sem tocar em `inventory.ts` (§11, #396): um `Wearer` com a
 * capacidade PESSOAL já descontada do que a party reservou. Objeto NOVO — nunca escreve
 * `character.capacity` (invariante 9), e `Inventory.add` continua vendo o dono real depois.
 */
function withReservedCapacity(character: CharacterRuntime, reserved: number): Wearer {
  return {
    level: character.level,
    vocationId: character.vocationId,
    capacity: Math.max(0, character.capacity - reserved),
  };
}

/** O `Runner` serializado. Ver `HuntRulesetState.runners`. */
export interface RunnerState {
  readonly route: RouteState;
  readonly botScheduled: readonly string[];
  readonly luring: boolean;
  readonly ringReplaced: string | null;
  readonly playerAttackReady: boolean;
  readonly warnedExhausted: boolean;
  readonly warnedFullBackpack: boolean;
  readonly warnedNoGold: boolean;
  /**
   * Por automação, a última chave `reason:itemId` que já virou `automation-blocked` (AB-08,
   * #420). Precisa entrar no snapshot: sem ele, uma hunt retomada volta a registrar o mesmo
   * aviso a cada ciclo, que é o defeito que este campo fecha. Ausente é "nada avisado".
   */
  readonly automationWarned?: Readonly<Record<string, string>>;
  /**
   * O alvo selecionado (#444). Precisa entrar no snapshot: o alvo persiste no runner até
   * morrer ou sair da tela, e a hunt retomada continua mirando nele. Ausente é "sem alvo" —
   * snapshot anterior, que cai na política no primeiro evento.
   *
   * O NOME do campo é o do formato persistido e não mudou com o #470: na memória ele virou
   * `attackTarget` + `botCandidate`, e `#runnerStateOf`/`#newRunner` fazem a tradução. Renomear
   * a chave do snapshot exigiria bump de formato e tolerância de leitura por uma mudança que
   * não altera o que é gravado (ADR 0014).
   */
  readonly chosenTarget?: string | null;
  /** O alvo é do jogador (AB-09/#480) ou do auto-target (#444)? Ausente é auto (`false`). */
  readonly chosenTargetPinned?: boolean;
  readonly botConfig?: BotConfigV2;
  readonly pendingExit?: ExitReason;
  /**
   * Já reportamos `active:false` para o follow deste participante (#398). Opcional e OMITIDO
   * quando `false`: um snapshot de hunt sem follow configurado não muda de tamanho.
   */
  readonly followInterrupted?: boolean;
  /** O alvo do follow (#401). Opcional: snapshot anterior a esta issue não o tem. */
  readonly followTargetId?: string;
  /** A razão da interrupção do follow (#401). Opcional pelo mesmo motivo. */
  readonly followReason?: 'dead' | 'left' | 'unreachable';
}

export class HuntRuleset implements Ruleset {
  readonly type = 'hunt' as const;

  readonly #options: HuntRulesetOptions;
  /** Um `Runner` por participante presente (#203). Ver `Runner`. */
  readonly #runners = new Map<string, Runner>();
  /** A party (#191): modo e líder. `undefined` é solo. Vem das opções ou do snapshot. */
  #party: PartyOptions | undefined;
  /**
   * A bolsa do modo compartilhado (#192, ADR 0027 decisão 5; #396): todo loot cai aqui, com
   * capacidade igual à soma das capacidades DISPONÍVEIS dos presentes; em OVERWEIGHT o item com
   * peso que não cabe fica no cadáver — não vai para a caixa do líder. `#bagWeight` é derivado e
   * recalculado na retomada; `#bagSeq` dá o id das instâncias (`sessionId:bag:n`), que precisam
   * ser únicas na sessão.
   */
  #bag: PartyBagState | null = null;
  #bagWeight = 0;
  #bagSeq = 0;
  /** Alguém saiu e a cascata do §13.9 ainda não rodou (#193). Ver `onLeave`. */
  #lossPending = false;
  /**
   * A votação de encerrar a hunt para todos (#432, ADR 0032 d.14), ou `null` sem votação.
   * `approved` guarda quem já aprovou, na ordem; o vencimento é o evento `END_VOTE_EXPIRE`.
   */
  #endVote: { proposedAtMs: number; readonly approved: Set<string> } | null = null;
  /**
   * O que o `restore` leu e ainda não pôde materializar: os participantes só existem depois
   * dele, e `onResume` é quem os casa com o estado. `legacy` é o snapshot de um dono só.
   */
  #pendingRunners: { readonly byId: Readonly<Record<string, RunnerState>> | null; readonly legacy: RunnerState | null } | null = null;
  readonly #difficulty: HuntDifficulty;
  /**
   * As regras injetadas por quem montou o ruleset, separadas das do jogador.
   *
   * Precisam ficar guardadas à parte porque a lista efetiva é RECOMPOSTA três vezes — na
   * construção, na restauração e a cada troca de configuração — e sem separar não há como
   * recompor sem duplicar as injetadas ou perdê-las. Foi assim que a restauração passou a
   * voltar sem as regras de saída, e o teste de retomada pegou.
   */
  readonly #injectedExitRules: readonly HuntExitRule[];
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
  /** Os cadáveres no chão, e o próximo id de item de chão (FUN-123). */
  #corpses: CorpseState[] = [];
  #nextGroundItemId = 1;
  /**
   * Os campos de tile ativos (CMB-07), indexados por chave NUMÉRICA de tile. O `Tilemap` é
   * conteúdo imutável; o campo é estado do ruleset (DT-01).
   */
  #fields = new Fields();

  /** Até que instante lógico a stamina já foi cobrada. Ver `#burnStamina`. */
  #staminaAnchorMs = 0;

  /** A view do bot, reaproveitada (FUN-80): montar uma por avaliação é alocar por evento. */
  readonly #botView: BotView = {
    self: null as unknown as CharacterRuntime, targetCount: 0, target: null, partyTarget: null,
  };

  /**
   * Resolve grupo e chave de cooldown de uma ação do CONTEÚDO, uma vez por slot, na compilação
   * (DT-01). Puro: só lê os catálogos fixados na sessão, nunca o disco (invariante 7).
   *
   * Magia de grupo tranca `group:<g>` (o `castSpell` já o aplica); ação sem grupo declarado cai
   * no livro individual `spell:<id>`/`item:<id>`, para não inventar prioridade compartilhada
   * (DT-06).
   */
  readonly #cooldownOf: CooldownOfAction = (action) => {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      const group = spell?.group;
      return group === undefined
        ? { group: `spell:${action.spellId}`, cooldownKey: spellCooldownKey(action.spellId) }
        : { group, cooldownKey: groupCooldownKey(group) };
    }
    const supply = this.#options.supplies.get(action.supplyId);
    const group = supply?.group;
    return group === undefined
      ? { group: `supply:${action.supplyId}`, cooldownKey: supplyCooldownKey(action.supplyId) }
      : { group, cooldownKey: groupCooldownKey(group) };
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
   * A munição BÁSICA de cada família (ADR 0026 d.3): a primeira em ordem de id. É o padrão de
   * quem nunca escolheu — o tiro usa a seleção da família, ou esta. Resolvida UMA vez, no
   * boot da instância: nenhuma varredura de catálogo por tiro.
   */
  readonly #basicAmmo: ReadonlyMap<AmmoFamily, Ammunition>;

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
  /**
   * Os ALIADOS de uma cura em área (#475, Mass Healing), na ordem dos participantes da sessão.
   * Reaproveitado como `#spellHits`: a cura de grupo roda por lançamento, e o vetor novo só é
   * o do evento. O conjurador entra nele, mas quem já o curou foi o `castSpell` — o laço pula.
   */
  readonly #healAllies: CharacterRuntime[] = [];
  /** Os tiles da forma do último lançamento (#155), para o efeito por tile. Reaproveitado. */
  #aimTiles: WorldPoint[] = [];
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
    this.#party = normalizePartyOptions(options.partyOptions);
    if (this.#party?.splitLoot) this.#bag = { gold: [], items: [], capacity: 0, overweight: false };
    this.#difficulty = difficulty;
    this.#injectedExitRules = options.exitRules ?? [];
    this.#skillsByGain = {
      'melee-hit': [...options.skills.values()].filter((sk) => sk.gain.on === 'melee-hit'),
      'distance-hit': [...options.skills.values()].filter((sk) => sk.gain.on === 'distance-hit'),
      'spell-cast': [...options.skills.values()].filter((sk) => sk.gain.on === 'spell-cast'),
      'shield-block': [...options.skills.values()].filter((sk) => sk.gain.on === 'shield-block'),
    };
    this.#spawner = new Spawner(options.route.spawnPoints.length, difficulty);
    this.#world = new TileOccupancy(options.map);
    // A básica por família é a primeira em ordem de id (determinístico, sem varredura por tiro).
    const basics = new Map<AmmoFamily, Ammunition>();
    for (const ammo of [...options.ammunition.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!basics.has(ammo.family)) basics.set(ammo.family, ammo);
    }
    this.#basicAmmo = basics;
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

  get huntId(): string {
    return this.#options.hunt.id;
  }

  get difficulty(): string {
    return this.#options.difficulty;
  }

  attackTargetOf(character: CharacterRuntime): MonsterRuntime | null {
    return this.#attackTarget(character);
  }

  /**
   * Dispara um slot do conjunto ATIVO na hora, ignorando `when` e `auto` (AB-09, ADR 0032 d.3).
   *
   * Manual é manual: a elegibilidade natural é a mesma do bot (`#perform`), mas a condição do
   * slot e a chave automática NÃO valem — o jogador apertou a tecla. `enabled: false` continua
   * valendo (desligado é explícito). O `set` defasado é recusa, não "usa o ativo": o cliente
   * disparou por uma barra que mudou (DT-03).
   *
   * Cooldown é conferido ANTES de executar, e a ação que não aconteceu não inicia cooldown
   * nenhum — a ordem da elegibilidade é o ponto caro aqui.
   */
  useSlot(session: Session, characterId: string, set: number, slotIndex: number): SlotOutcome {
    const character = findById(session.participants, characterId);
    const runner = this.#runners.get(characterId);
    if (character === null || !character.alive || runner === undefined) {
      return refuse('not-in-catalog', 0);
    }
    const config = runner.botConfig;
    if (config === undefined) return refuse('empty-slot', 0);
    if (set !== config.activeSet) return refuse('wrong-set', 0);
    const entry = config.sets[set]?.slots[slotIndex];
    if (entry === null || entry === undefined) return refuse('empty-slot', 0);
    if (entry.enabled === false) return refuse('disabled', 0);

    const wait = this.#cooldownWaitOf(character, entry.do, session.nowMs);
    if (wait > 0) return refuse('on-cooldown', wait);

    const result = this.#perform(session, character, entry.do);
    if (!result.ok) return refuse(refusalOf(result), result.retryInMs);
    // A ação SAIU: o ciclo automático passa a respeitar o cooldown que ela acabou de iniciar.
    this.#armBot(session, characterId);
    return { ok: true };
  }

  /**
   * O estado dos slots do conjunto ATIVO (AB-09), para o `slot-state`. PURO: não muta nada e
   * não consome RNG — é a apresentação da mesma elegibilidade que `useSlot` executaria.
   */
  slotStates(session: Session, character: CharacterRuntime): readonly SlotState[] {
    const config = this.#runners.get(character.id)?.botConfig;
    const set = config?.activeSet ?? 0;
    const out: SlotState[] = [];
    for (let slot = 0; slot < BOT_SLOTS_PER_SET; slot += 1) {
      const entry = config?.sets[set]?.slots[slot] ?? null;
      if (entry === null) {
        out.push({ set, slot, state: 'empty', remainingMs: 0 });
        continue;
      }
      if (entry.enabled === false) {
        out.push({ set, slot, state: 'blocked', remainingMs: 0, reason: 'disabled' });
        continue;
      }
      const wait = this.#cooldownWaitOf(character, entry.do, session.nowMs);
      if (wait > 0) {
        out.push({ set, slot, state: 'cooldown', remainingMs: wait, reason: 'on-cooldown' });
        continue;
      }
      out.push(this.#naturalStateOf(set, slot, character, entry.do));
    }
    return out;
  }

  /**
   * O jogador escolheu um alvo clicando (AB-09, ADR 0032 d.5). `false` se não é monstro vivo —
   * o host ignora em silêncio, como o `walk` recusado. O override vale para qualquer política e
   * sobrepõe a busca enquanto o alvo vive (DT-05).
   */
  chooseTarget(session: Session, characterId: string, subject: string): boolean {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return false;
    const character = findById(session.participants, characterId);
    if (character === null) return false;
    this.setAttackTarget(character, monster);
    return true;
  }

  /**
   * O monstro vivo por subject, ou `null` (#470). É a ponte do host: o `select-target` chega
   * com o id numérico do fio, e quem o traduz para o runtime é `#subjectOfCreature` do host;
   * aqui ele resolve o subject validado no runtime que `setAttackTarget` recebe.
   */
  monsterBySubject(subject: string): MonsterRuntime | null {
    const monster = this.#monsterBySubject.get(subject);
    return monster !== undefined && monster.alive ? monster : null;
  }

  /**
   * O alvo de ATAQUE explícito (#470): o jogador (AB-09) e o bot (#480). `null` limpa — é o
   * cancelamento do `creatureId: 0`. É a ÚNICA porta de escrita do `attackTarget`, para jogador
   * e bot não terem dois pipelines que divergem (§42: o bot manda os mesmos comandos).
   *
   * `pinned` distingue quem escreveu: o clique do jogador é EXCLUSIVO (fora do alcance não cai
   * na política), a eleição do bot não é — ela é uma mirada corrente, e a política reassume
   * quando ela sai do alcance. Quem chama com a assinatura de dois argumentos é o jogador, e
   * por isso o padrão é `true`; o bot passa `false` explicitamente.
   *
   * Não valida: quem valida é quem resolve o runtime (o host contra o id do fio, o bot contra a
   * política), e o alvo morto é limpo na primeira leitura por `#attackTargetOfRunner`.
   */
  setAttackTarget(
    character: CharacterRuntime, target: MonsterRuntime | null, pinned = true,
  ): void {
    const runner = this.#runners.get(character.id);
    if (runner === undefined) return;
    runner.attackTarget = target === null ? null : target.subject;
    runner.attackTargetPinned = target !== null && pinned;
  }

  /**
   * O alvo SELECIONADO para a apresentação (#470, RF-05): o alvo de ataque se houver, senão o
   * candidato do auto-target. **Não é recortado pelo alcance da arma** — é o que mantém o
   * alvo na tela enquanto a criatura está viva e na sessão (o raio de busca), mesmo fora do
   * corpo a corpo. Não muta: apresentação não escreve estado quente (invariante 3).
   */
  selectedTargetOf(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined) return null;
    return this.#liveTargetOf(runner.attackTarget, character)
      ?? this.#liveTargetOf(runner.botCandidate, character);
  }

  /** Os cadáveres no chão agora (FUN-123): quem reanexa precisa vê-los no `session-state`. */
  get groundItems(): readonly CorpseState[] {
    return this.#corpses;
  }

  /** Os campos de tile ativos agora (CMB-07): leitura para snapshot, host e teste. */
  get fields(): readonly TileFieldState[] {
    return this.#fields.getState();
  }

  /** O prazo de um cadáver venceu: sai do chão, e a tela fica sabendo. */
  #onCorpseDecay(session: Session, subject: string): void {
    const id = Number(subject);
    const index = this.#corpses.findIndex((corpse) => corpse.id === id);
    if (index === -1) return;
    this.#corpses.splice(index, 1);
    session.emit({ kind: 'ground-item-vanished', itemId: id });
  }

  /** O ambiente da hunt (FUN-121), do conteúdo — `cavern` no bueiro. Ausente é superfície. */
  get ambience(): 'surface' | 'cavern' | undefined {
    return this.#options.hunt.ambience;
  }

  /** A party desta instância (#191), ou `undefined` em solo. */
  get party(): PartyOptions | undefined {
    return this.#party;
  }

  /**
   * Prévia pura do rateio da bolsa compartilhada (#354, SV-18): quanto cada presente receberia se a bolsa
   * fosse liquidada AGORA — a MESMA conta de `#settle` (linha 2578), chamada como LEITURA, sem
   * gravar nada e sem esvaziar a bolsa. `undefined` fora do modo `shared` (não há bolsa a ratear)
   * e em solo (`#party` ausente) — D8: sistema/dado inexistente é omitido, nunca um zero fabricado.
   */
  partySpendingPreview(session: Session): ReadonlyMap<string, number> | undefined {
    if (this.#party === undefined || !this.#party.splitLoot || this.#bag === null) return undefined;
    const presentIds = session.participants.map((p) => p.id);
    return settleEntries(this.#bag, presentIds, this.#options.items).shares;
  }

  /**
   * Muda a configuração da party (D1, D2). Só o líder pode; a validação de catálogo acontece
   * ANTES de qualquer mutação — ou tudo se aplica, ou nada (como `configureBot`, mas com recusa
   * tipada porque aqui a recusa é visível ao jogador, não só um no-op silencioso).
   *
   * Chamado pelo host ENTRE avanços, a partir do opcode C2S `party-settings` (#400) — nunca
   * dentro de `advanceBy` (invariante 2). O cliente manda intenção crua; quem valida é aqui.
   */
  configureParty(
    session: Session, patch: PartySettingsPatch, byCharacterId: string,
  ): ConfigurePartyResult {
    const party = this.#party;
    if (party === undefined || byCharacterId !== party.leaderId) {
      return { ok: false, reason: 'not-leader' };
    }
    if (patch.collect !== undefined && patch.collect !== null) {
      for (const itemId of patch.collect) {
        if (!this.#options.items.has(itemId)) return { ok: false, reason: 'unknown-item', itemId };
      }
    }
    if (patch.autoSell !== undefined) {
      for (const itemId of patch.autoSell) {
        const item = this.#options.items.get(itemId);
        if (item === undefined) return { ok: false, reason: 'unknown-item', itemId };
        if (item.value === 0) return { ok: false, reason: 'unsellable-item', itemId };
      }
    }
    const next: PartySettings = {
      shareCosts: patch.shareCosts ?? party.shareCosts,
      splitLoot: patch.splitLoot ?? party.splitLoot,
      collect: patch.collect === undefined ? party.collect : patch.collect,
      autoSell: patch.autoSell ?? party.autoSell,
    };
    // Ligar: nasce vazia, igual ao construtor. Desligar: liquida com quem está presente AGORA
    // vendendo entrada por entrada (#395) e descarta. Nada se perde: vira gold ou vai para o
    // líder (`value: 0`, `unsold` de `settleEntries`).
    if (next.splitLoot && !party.splitLoot) this.#bag = { gold: [], items: [], capacity: 0, overweight: false };
    if (!next.splitLoot && party.splitLoot && this.#bag !== null) {
      this.#settle(session, session.participants, 'toggle');
      this.#bag = null;
    }
    party.shareCosts = next.shareCosts;
    party.splitLoot = next.splitLoot;
    party.collect = next.collect;
    party.autoSell = next.autoSell;
    // `configureParty` é um dos gatilhos do §13: ligar/desligar `splitLoot` muda o conjunto de
    // reservas, e mudar a lista de coleta/venda muda o que entra — rebalanceia e emite.
    this.#rebalanceBag(session);
    return { ok: true };
  }

  /**
   * O líder propõe encerrar a hunt para TODOS (#432, ADR 0032 d.14). Não encerra nada: abre uma
   * votação com a própria aprovação do líder (quem propõe, aprova), agenda o vencimento de 60 s
   * na fila e emite `party-end-vote`. Só o líder propõe; solo (sem party) não tem líder, como
   * em `configureParty`.
   *
   * Re-propor REINICIA a janela: cancela o vencimento anterior e esvazia as aprovações, exceto a
   * do líder. É a leitura literal de "o líder propõe" — quem propõe de novo está propondo de
   * novo, não confirmando a proposta velha.
   */
  proposeEnd(session: Session, byLeaderId: string): PartyEndVoteResult {
    const party = this.#party;
    if (party === undefined || byLeaderId !== party.leaderId) {
      return { ok: false, reason: 'not-leader' };
    }
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = { proposedAtMs: session.nowMs, approved: new Set([byLeaderId]) };
    session.scheduleIn(END_VOTE_EXPIRE, END_VOTE_WINDOW_MS, {
      priority: EventPriority.Housekeeping, subject: END_VOTE_SUBJECT,
    });
    this.#emitEndVote(session);
    // Uma party que virou um só (todos os outros saíram): a proposta do líder já é o sim de
    // TODOS os presentes, e a sessão encerra na hora.
    this.#settleEndVote(session);
    return { ok: true };
  }

  /**
   * Um membro presente aprova a proposta em curso (#432). Quando o último presente aprova, a
   * sessão encerra com `party-vote` — o settlement e os extratos saem pelo caminho de sempre
   * (`onEnd` + `Session.end`). Sem proposta aberta é `no-proposal`; id ausente é `not-member`.
   */
  approveEnd(session: Session, characterId: string): PartyEndVoteResult {
    const vote = this.#endVote;
    if (vote === null) return { ok: false, reason: 'no-proposal' };
    if (!session.participants.some((p) => p.id === characterId)) {
      return { ok: false, reason: 'not-member' };
    }
    vote.approved.add(characterId);
    this.#emitEndVote(session);
    this.#settleEndVote(session);
    return { ok: true };
  }

  /**
   * Recusa a proposta em curso (#432): qualquer membro presente (ou o próprio líder) derruba a
   * votação. Como uma recusa impede o "sim de todos", a proposta morre agora e a sessão segue
   * exatamente como estava — o mesmo desfecho de expirar, sem esperar a janela.
   */
  cancelEnd(session: Session, byCharacterId: string): PartyEndVoteResult {
    if (this.#endVote === null) return { ok: false, reason: 'no-proposal' };
    if (!session.participants.some((p) => p.id === byCharacterId)) {
      return { ok: false, reason: 'not-member' };
    }
    this.#clearEndVote(session);
    return { ok: true };
  }

  /**
   * O estado da votação para quem reconecta (#432). `undefined` sem party — não há votação
   * fora de party. O getter é PURO (sem `emit`), como `partySummary`: o host o chama no attach.
   */
  endVoteState(): { active: boolean; proposedAtMs: number; approved: readonly string[] } | undefined {
    if (this.#party === undefined) return undefined;
    const vote = this.#endVote;
    return {
      active: vote !== null,
      proposedAtMs: vote?.proposedAtMs ?? 0,
      approved: vote === null ? [] : [...vote.approved],
    };
  }

  #emitEndVote(session: Session): void {
    if (this.#party === undefined) return;
    const vote = this.#endVote;
    session.emit({
      kind: 'party-end-vote',
      active: vote !== null,
      proposedAtMs: vote?.proposedAtMs ?? 0,
      approved: vote === null ? [] : [...vote.approved],
    });
  }

  /** Derruba a votação e avisa; o vencimento agendado morre com ela. */
  #clearEndVote(session: Session): void {
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = null;
    this.#emitEndVote(session);
  }

  /**
   * Encerra se TODOS os presentes já aprovaram. É o único ponto que decide "o sim de todos": a
   * aprovação, a entrada e a saída passam por aqui, e a comparação é contra os presentes AGORA —
   * quem saiu deixa de contar (ver `onLeave`).
   */
  #settleEndVote(session: Session): void {
    const vote = this.#endVote;
    if (vote === null) return;
    if (session.participants.some((p) => !vote.approved.has(p.id))) return;
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = null;
    this.#emitEndVote(session);
    session.end('party-vote');
  }

  #onEndVoteExpire(session: Session): void {
    // Sem votação é um vencimento órfão (re-propor cancela o anterior): ignorar é a degradação
    // certa, e é o que mantém a fila de uma sessão retomada inofensiva.
    if (this.#endVote === null) return;
    this.#endVote = null;
    this.#emitEndVote(session);
  }

  /**
   * O premium de quem entrou DEPOIS da construção da sessão (#397). `#394` grava
   * `premiumByCharacter` na criação; isto é o único jeito de escrevê-lo para um joiner — sem
   * checagem de líder, porque premium é fato sobre o PRÓPRIO personagem, não configuração da
   * party. Ausência de party é no-op: solo não tem `premiumByCharacter`.
   */
  setMemberPremium(session: Session, characterId: string, premium: boolean): void {
    if (this.#party === undefined) return;
    this.#party = {
      ...this.#party,
      premiumByCharacter: { ...this.#party.premiumByCharacter, [characterId]: premium },
    };
  }

  /**
   * O bloco PARTY dos Detalhes da Caçada (§32, ADR 0035 decisão 11). Getter PURO, sem `emit()`:
   * o host o chama por ciclo, como `partySpendingPreview` (DT-03). `undefined` fora de party.
   *
   * `autoSell.limit` é o do PERSONAGEM líder (D3): o conteúdo manda os números, a sessão só lê.
   * `autoSell.configured` é quantos ids o líder guardou — a aplicação de fato é do #395.
   */
  partySummary(session: Session): PartySummary | undefined {
    const party = this.#party;
    if (party === undefined) return undefined;
    const present = session.participants.map((p) => ({ id: p.id, vocationId: this.#vocationOf(p)?.id ?? null }));
    const unique = uniqueVocations(present);
    const xpPoolPercent = this.#options.party.xpPoolPercentByUniqueVocations[String(unique)] ?? 100;
    const value = this.#bag === null ? 0 : bagValue(this.#bag, this.#options.items);
    // O conteúdo sempre preenche (`partySchema` transforma com `{ free: 5, premium: 20 }`); o
    // tipo é opcional por causa das fixtures antigas de `RawContent`.
    const limit = autoSellLimit(
      party.premiumByCharacter, party.leaderId, this.#options.party.autoSellItemTypes,
    );
    return {
      leaderId: party.leaderId,
      shareCosts: party.shareCosts,
      splitLoot: party.splitLoot,
      members: session.participants.map((p) => p.id),
      uniqueVocations: unique,
      xpPoolPercent,
      bagValue: value,
      bagWeight: this.#bagWeight,
      autoSell: { configured: party.autoSell.length, limit },
    };
  }

  /** O índice na rota do PRIMEIRO participante (#203) — o solo de sempre; `-1` sem ninguém. */
  get routeIndex(): number {
    const first = this.#runners.values().next().value as Runner | undefined;
    return first?.walker.index ?? -1;
  }

  /** O índice na rota de um participante, para quem tem o id. */
  routeIndexOf(characterId: string): number {
    return this.#runners.get(characterId)?.walker.index ?? -1;
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
    // Recusa o (maxMembers + 1)-ésimo (§22, #397) ANTES de qualquer efeito colateral — criar o
    // runner, resetar a ocupação do mundo — para que a reversão em `Session.enter` não precise
    // desfazer nada além do próprio push. `character` já está em `session.participants`
    // (empurrado por `Session.enter` antes de chamar `onEnter`): por isso o teste é `>`, não
    // `>=`, contra o limite do CONTEÚDO da party (#392), não um valor fixo da issue.
    if (this.#party !== undefined && session.participants.length > this.#options.party.maxMembers) {
      throw new PartyFullError(this.#options.hunt.id, this.#options.party.maxMembers);
    }
    // Um `Runner` por participante (#203): o caminhante, o bot e o resto do que era campo da
    // classe quando a hunt hospedava um só. O bot é o DELE — por id, ou o da opção solo para
    // o primeiro a entrar.
    const config = this.#options.botConfigs?.[character.id]
      ?? (this.#runners.size === 0 ? this.#options.botConfig : undefined);
    const runner = this.#newRunner(config, undefined, character);
    this.#runners.set(character.id, runner);
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
    // Os containers ganham os tamanhos iniciais aqui (#160) — é onde o conteúdo existe, e é o
    // que migra um snapshot anterior sem bump: nunca encolhe.
    character.inventory.ensureContainers(this.#containerRules(character));
    // Instala o observer e agenda o vencimento do que já está vestido (ADR 0032 d.8): a
    // entrada fresca não passa por `equip`, e o anel que já vinha do ticket precisa vencer.
    this.#armEquipment(session, character);
    // O primeiro entra NO tile inicial da rota; o segundo em diante, no livre mais próximo —
    // tile é exclusivo, e o `rejoinNearest` do primeiro passo o põe na rota (#203).
    const at = runner.walker.current;
    const refused = this.#runners.size === 1
      ? place(this.#world, character, at)
      : placeNear(this.#world, character, at, ENTRY_RADIUS);
    if (refused !== null) {
      throw new Error(
        `não dá para entrar na hunt "${this.#options.hunt.id}": o primeiro tile da rota ` +
          `(${at.x},${at.y}) foi recusado — ${refused}`,
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

    // Spawn e regras de saída são da INSTÂNCIA, não do participante (#203): entram na fila com
    // o primeiro, e o segundo não os dobra.
    if (this.#runners.size === 1) {
      for (let slot = 0; slot < this.#spawner.slots.length; slot++) {
        session.scheduleIn(SPAWN, 0, { priority: EventPriority.Spawn, subject: String(slot) });
      }
      session.scheduleIn(EXIT_RULES, EXIT_RULE_INTERVAL_MS, {
        priority: EventPriority.Housekeeping,
      });
    }
    // Só grupo COM regra entra na fila (AB-07). Um personagem sem bot configurado não agenda
    // nada, e os eventos por grupo só existem para quem de fato configurou.
    this.#autoSelectTarget(session, character);
    this.#armBot(session, character.id);
    // As automações (AB-08) seguem a mesma regra: só quem habilitou alguma entra na fila.
    this.#armAutomations(session, character.id);
    // Só depois de tudo pronto (runner armado, posição válida): quem já está OLHANDO a sessão
    // precisa saber que a lotação mudou, e a bolsa precisa recalcular reserva por membro — um
    // join em curso muda `ΣB` (#396) do mesmo jeito que uma saída muda. O aviso é incondicional
    // em party (#397, DT-05): numa hunt tranquila o próximo evento de party pode nunca chegar
    // antes do fim, e os outros presentes precisam ver o novo membro agora.
    if (this.#party !== undefined) this.#emitPartyState(session);
    // `onEnter` é gatilho do §13: quem entra muda a capacidade disponível (e a reserva) dos
    // outros. Depois de tudo montado, para o participante novo já contar.
    this.#rebalanceBag(session);
  }

  /**
   * Um participante saiu de uma hunt que continua (#203, ADR 0027): desfaz o que a entrada fez.
   * O tile é liberado; o `Runner` some — os eventos dele ainda na fila vencem, não encontram o
   * personagem e não fazem nada, como os de um morto. Quem o tinha como alvo perde o alvo no
   * próximo passo, porque a mira é recalculada a cada vencimento.
   */
  onLeave(session: Session, character: CharacterRuntime): void {
    // REMONTA a ocupação no próximo evento, em vez de liberar `character.position`: numa
    // transição quem sai já pode ter sido colocado no mapa de destino, e `TileOccupancy`
    // guarda coordenada, não dono — é a armadilha da FUN-72, registrada no `onLeave` da Cidade.
    this.#occupancyStale = true;
    this.#runners.delete(character.id);
    // Quem seguia `character` para de seguir AGORA (§D10, #398). É AQUI — e não de forma lazy
    // no próximo `#holdFollow` — porque depois do `splice` de `Session.leave` morte e saída
    // manual ficam indistinguíveis por presença, e `character.alive` só é confiável antes dele.
    this.#interruptFollowersOf(session, character);
    // O observer sai com ele: a Cidade não simula, e uma closure apontando para a sessão que
    // ele deixou vazaria. A carga/duração dele não o segue (fora do escopo, §12).
    character.inventory.setEquipmentObserver(null);
    // As condições dele saem com ele (CMB-07): o vencimento de quem já saiu não fica órfão.
    this.#cancelConditions(session, character);
    // A bolsa é vendida e dividida COM quem sai (#192, ADR 0027 decisão 5): ele leva a parte
    // do que caiu enquanto estava — `Session.leave` emite o extrato dele depois disto, e é o
    // que põe o gold do settlement nele. A capacidade encolhe sem descartar nada: acima do
    // teto a bolsa só para de aceitar, até o próximo settlement zerar.
    if (this.#bag !== null) this.#settle(session, [...session.participants, character], 'leave');
    // A votação de encerrar é dos PRESENTES (#432): quem sai deixa de contar. O vencimento
    // continua correndo; se quem ficou já tinha aprovado todo, `#flushLoss` encerra — depois do
    // extrato de quem saiu, pela mesma ordem que a cascata respeita.
    if (this.#endVote !== null) this.#endVote.approved.delete(character.id);
    // A cascata do §13.9 NÃO roda aqui: `Session.leave` ainda vai emitir o extrato de quem
    // está saindo, e uma cascata dentro do `onLeave` emitiria os extratos dos outros ANTES
    // do dele — `seq` fora de ordem e o `member-left` do primeiro depois dos demais. Fica
    // pendente e roda logo depois: em `#depart` (saída decidida aqui) ou no próximo evento
    // (saída pelo socket, que o hospedeiro chama direto).
    this.#lossPending = true;
  }

  /**
   * A cascata pendente do §13.9 e a liderança por TEMPO de party (#193, D9): `participants[0]`
   * já é o mais antigo, e `leaderId` passa a ser reescrito quando o líder sai — não só lido com
   * fallback. A troca entra no extrato (`leader-changed`) e o `party-state` avisa.
   * Sem ninguém, nada a anunciar — a sessão encerra.
   */
  #flushLoss(session: Session, reason: 'death' | 'exit-rule' | 'manual-exit'): void {
    if (!this.#lossPending) return;
    this.#lossPending = false;
    const cascaded = this.#onMemberLost(session);
    if (session.participants.length === 0) {
      // O motivo é o do ÚLTIMO a sair: se a cascata levou alguém, foi a regra dele.
      if (session.ended === null) session.end(cascaded > 0 ? 'exit-rule' : reason);
      return;
    }
    const party = this.#party;
    if (party !== undefined && !session.participants.some((p) => p.id === party.leaderId)) {
      const next = session.participants[0];
      if (next !== undefined) {
        party.leaderId = next.id;
        session.record('leader-changed', next.id);
      }
    }
    this.#emitPartyState(session);
    // A saída pode ter completado o "sim de todos" (#432): quem ficou e já tinha aprovado
    // encerra agora, depois do extrato de quem saiu.
    this.#settleEndVote(session);
  }

  #emitPartyState(session: Session): void {
    if (this.#party === undefined) return;
    const leader = this.#leader(session);
    session.emit({
      kind: 'party-state',
      leaderId: leader?.id ?? this.#party.leaderId,
      members: session.participants.map((p) => ({ characterId: p.id, alive: p.alive })),
    });
  }

  requestExit(session: Session, characterId: string): void {
    this.#beginExit(session, characterId, 'manual-exit');
  }

  #newRunner(
    config: BotConfigInput | undefined, state?: RunnerState, character?: CharacterRuntime,
  ): Runner {
    // A v1 é normalizada no boundary (DT-02): a config que o jogador salvou continua valendo, e
    // o motor v2 só vê o vocabulário v2. Idempotente — um snapshot v2 volta só parseado.
    const normalized = config === undefined ? undefined : migrateBotConfigV1(config);
    const bot = normalized === undefined ? undefined : compileBot(normalized, this.#cooldownOf);
    const runner: Runner = {
      walker: new RouteWalker(this.#options.route, state?.route),
      bot,
      botConfig: normalized,
      automations: compileAutomations(normalized?.automations ?? []),
      actuator: undefined,
      automationWarned: new Map(Object.entries(state?.automationWarned ?? {})),
      exitRules: this.#composeExitRules(normalized),
      pendingExit: state?.pendingExit ?? null,
      botReady: {},
      playerAttackReady: state?.playerAttackReady ?? true,
      // O snapshot guarda um alvo só (#470): `chosenTargetPinned` dizia se ele era do
      // jogador. Na memória ele vira `attackTarget` (explícito) ou `botCandidate` (auto).
      attackTarget: state?.chosenTargetPinned === true ? (state.chosenTarget ?? null) : null,
      botCandidate: state?.chosenTargetPinned === true ? null : (state?.chosenTarget ?? null),
      attackTargetPinned: state?.chosenTargetPinned === true,
      running: state?.luring ?? true,
      ringReplaced: state?.ringReplaced ?? null,
      warnedExhausted: state?.warnedExhausted ?? false,
      warnedFullBackpack: state?.warnedFullBackpack ?? false,
      warnedNoGold: state?.warnedNoGold ?? false,
      followInterrupted: state?.followInterrupted ?? false,
      followTargetId: state?.followTargetId,
      followReason: state?.followReason,
    };
    // O atuador fecha sobre o PRÓPRIO runner (o `ringReplaced` das automações), então só pode
    // ser montado depois que o objeto existe — e é a razão de ele não entrar no literal.
    if (character !== undefined) runner.actuator = this.#automationActuatorFor(runner, character);
    if (bot !== undefined) {
      // Todo grupo começa ENGATILHADO. Só um snapshot v2 carrega chaves de grupo em
      // `botScheduled`; as categorias v1 (`potion`, `attack`, `support`) colidiriam com nomes
      // de grupo, e o motor v2 as re-engatilha — a fila restaurada de um snapshot v1 traz
      // `bot-<categoria>`, que o motor v2 ignora.
      for (const group of bot.groups.keys()) runner.botReady[group] = true;
      if (state?.botConfig?.version === BOT_VOCABULARY_VERSION) {
        for (const group of state.botScheduled) {
          if (runner.botReady[group] !== undefined) runner.botReady[group] = false;
        }
      }
    }
    return runner;
  }

  /** O `Runner` de um participante presente. Lançar é certo: evento de quem saiu é filtrado antes. */
  #runnerOf(characterId: string): Runner {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) throw new Error(`no runner for character ${characterId}`);
    return runner;
  }

  /**
   * Um evento venceu. `session.nowMs` é o instante exato do vencimento.
   *
   * Não existe mais ordem de fases: a ordem entre eventos que vencem no mesmo instante é a
   * prioridade deles (`EventPriority`), que reproduz a ordem que o `onTick` executava.
   */
  onEvent(session: Session, event: ScheduledEvent): void {
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    // Saída pelo socket (#193): a cascata roda no primeiro evento depois dela.
    this.#flushLoss(session, 'manual-exit');
    this.#burnStamina(session);

    switch (event.kind) {
      case PLAYER_STEP: return this.#onPlayerStep(session, event.subject);
      case PLAYER_ATTACK: return this.#onPlayerAttack(session, event.subject);
      case MONSTER_STEP: return this.#onMonsterStep(session, event.subject);
      case MONSTER_ATTACK: return this.#onMonsterAttack(session, event.subject);
      case MONSTER_ABILITY: return this.#onMonsterAbility(session, event.subject);
      case HEALTH_REGEN: return this.#onRegen(session, event.subject, 'health');
      case MANA_REGEN: return this.#onRegen(session, event.subject, 'mana');
      case SPAWN: return this.#onSpawn(session, event.subject);
      case CORPSE: return this.#onCorpseDecay(session, event.subject);
      case EXIT_RULES: return this.#onExitRules(session);
      case EXIT_COUNTDOWN: return this.#onExitCountdown(session, event.subject);
      case END_VOTE_EXPIRE: return this.#onEndVoteExpire(session);
      case CONDITION_TICK: return this.#onConditionTick(session, event.subject);
      case CONDITION_EXPIRE: return this.#onConditionExpire(session, event.subject);
      case FIELD_TICK: return this.#onFieldTick(session, event.subject);
      case FIELD_EXPIRE: return this.#onFieldExpire(session, event.subject);
      case EQUIP_EXPIRE: return this.#onEquipExpire(session, event.subject);
      case AUTOMATION: return this.#onAutomation(session, event.subject);
      default:
        // Um grupo do bot venceu (AB-07): `bot:<group>`. Um evento de tipo que este ruleset não
        // conhece — inclusive `bot-<categoria>` de um snapshot v1 — é ignorado, que é a
        // degradação certa.
        if (event.kind.startsWith(BOT_GROUP_PREFIX)) {
          return this.#onBot(session, event.kind.slice(BOT_GROUP_PREFIX.length), event.subject);
        }
        return;
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
      const runner = this.#runners.get(character.id);
      if (!exhausted || runner === undefined || runner.warnedExhausted) continue;
      runner.warnedExhausted = true;
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

    const ring = character.inventory.ringEffect(this.#options.items);
    const bonusPercent = ring?.kind === 'regen-boost' ? ring.percent : 0;
    const amount = Math.round(1 * (1 + bonusPercent / 100));

    if (what === 'health') {
      // Só a barra, sem `creature-healed` (FUN-109): um "+1" flutuando por segundo a hunt
      // inteira é ruído, mas a barra precisa andar. E só quando REPÔS — de vida cheia, nada
      // mudou, e um evento por segundo para dizer isso é o que uma hunt desanexada de oito
      // horas não precisa produzir.
      if (character.heal(amount) > 0) this.#emitCharacterHealth(session, character);
    } else {
      character.mana = Math.min(character.maxMana, character.mana + amount);
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
    // Morto não tem condição: cancelar aqui impede o vencimento de uma condição dele ficar
    // na fila até o fim da sessão (CMB-07).
    this.#cancelConditions(session, character);

    // A penalidade sai AQUI, na morte, e não no encerramento: quem morre paga, e uma hunt que
    // termina por saída manual ou por regra não custa XP nenhuma (§26.2). O Premium é do
    // PERSONAGEM morto (D3); fora de party cai para o `premium` de sessão, como no solo.
    const premium = this.#party?.premiumByCharacter[character.id] ?? this.#options.premium ?? false;
    const penalty = applyDeathPenalty(
      character,
      { premium },
      this.#vocationOf(character),
      this.#options.progression,
    );
    if (penalty.xpLost > 0) {
      // Entra no agregado como perda: o extrato é o que vira linha de ledger, e creditar a XP
      // ganha sem descontar a perdida daria ao jogador uma XP que ele não tem.
      session.credit(character.id, 'xpGained', -penalty.xpLost);
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

    // Solo — ou party que virou solo —: a morte encerra a sessão (§26.1), como sempre. Em party
    // (#193, ADR 0027 decisão 7) o morto SAI com o próprio extrato — penalidade dentro, e a
    // cota do settlement (`onLeave`) — e a sessão continua para os outros.
    if (session.participants.length <= 1) {
      session.end('death');
      return;
    }
    this.#depart(session, character.id, 'death');
  }

  /**
   * Um membro sai por decisão do ruleset — morte ou regra de saída (#193): `leave` emite o
   * extrato dele, e o hospedeiro recebe `member-left` com o extrato e o personagem, porque não
   * foi ele quem chamou. O último a sair encerra a sessão com o motivo dele.
   */
  #depart(session: Session, characterId: string, reason: 'death' | ExitReason): void {
    const departure = session.leave(characterId, reason);
    if (departure === null) return;
    session.emit({ kind: 'member-left', characterId, reason, departure });
    this.#flushLoss(session, reason);
  }

  /**
   * Alguém saiu: quem tem a regra `party-member-lost` sai também (§13.9), em cascata e na
   * ordem de entrada. A lista é copiada porque cada `leave` a muda no meio do laço — iterar
   * a viva pularia um membro. O próprio que saiu não está mais nela, por construção.
   */
  #onMemberLost(session: Session): number {
    let cascaded = 0;
    for (const member of [...session.participants]) {
      const runner = this.#runners.get(member.id);
      if (runner === undefined) continue;
      if (!runner.exitRules.some((rule) => rule.id === 'party-member-lost')) continue;
      session.record('exit-rule', 'party-member-lost');
      const departure = session.leave(member.id, 'exit-rule');
      if (departure === null) continue;
      // O `onLeave` deste marcou pendência de novo; a cascata É este laço, então a limpa.
      this.#lossPending = false;
      session.emit({ kind: 'member-left', characterId: member.id, reason: 'exit-rule', departure });
      cascaded += 1;
    }
    return cascaded;
  }

  onEnd(session: Session, _reason: EndReason): void {
    // O observer morre com a sessão: os eventos dele não vão mais vencer, e a closure não pode
    // segurar uma sessão encerrada.
    for (const character of session.participants) {
      character.inventory.setEquipmentObserver(null);
    }
    // A bolsa é vendida e dividida entre os presentes (#192); os extratos saem DEPOIS disto,
    // com o gold dentro. Fora isso nada a desfazer: a instância morre com a sessão. Todo
    // encerramento produz extrato, inclusive o que acontece sem ninguém assistindo — e é
    // exatamente por isso que ele não depende de nada feito aqui.
    if (this.#bag !== null) this.#settle(session, session.participants, 'end');
  }

  getState(): HuntRulesetState {
    const runners: Record<string, RunnerState> = {};
    for (const [id, runner] of this.#runners) runners[id] = runnerState(runner);
    // Os campos soltos são os do PRIMEIRO runner (#203, DT-02): um nó anterior lendo este
    // snapshot continua funcionando para o solo. Sem runner nenhum — sessão restaurada antes
    // de `onResume`? não acontece; sessão vazia —, saem os defaults.
    const first = this.#runners.values().next().value as Runner | undefined;
    const solo = first === undefined
      ? this.#newRunner(this.#options.botConfig)
      : first;
    const state = runnerState(solo);
    return {
      huntId: this.#options.hunt.id,
      difficulty: this.#options.difficulty,
      route: state.route,
      spawner: this.#spawner.getState(),
      monsters: this.#monsters.map((m) => m.getState()),
      nextCreatureId: this.#nextCreatureId,
      corpses: [...this.#corpses],
      fields: this.#fields.getState(),
      nextGroundItemId: this.#nextGroundItemId,
      warnedExhausted: state.warnedExhausted,
      warnedFullBackpack: state.warnedFullBackpack,
      warnedNoGold: state.warnedNoGold,
      staminaAnchorMs: this.#staminaAnchorMs,
      playerAttackReady: state.playerAttackReady,
      botScheduled: [...state.botScheduled],
      luring: state.luring,
      ringReplaced: state.ringReplaced,
      ...(state.botConfig === undefined ? {} : { botConfig: state.botConfig }),
      runners,
      // Sempre no formato NOVO (achatado). O campo continua opcional e sem bump: um nó antigo
      // que leia `partyOptions.mode`/`shareCosts`/`splitLoot` ainda encontra os três.
      ...(this.#party === undefined ? {} : {
        partyOptions: {
          leaderId: this.#party.leaderId,
          mode: this.#party.mode,
          shareCosts: this.#party.shareCosts,
          splitLoot: this.#party.splitLoot,
          collect: this.#party.collect,
          autoSell: this.#party.autoSell,
          premiumByCharacter: this.#party.premiumByCharacter,
        },
      }),
      ...(this.#bag === null ? {} : {
        partyBag: {
          gold: [...this.#bag.gold],
          items: this.#bag.items.map((entry) => ({ item: entry.item, eligible: [...entry.eligible] })),
          capacity: this.#bag.capacity,
          overweight: this.#bag.overweight,
        },
      }),
      ...(this.#endVote === null ? {} : {
        endVote: {
          proposedAtMs: this.#endVote.proposedAtMs,
          approved: [...this.#endVote.approved],
        },
      }),
    };
  }

  /**
   * Depois do `restore`, com os participantes de pé: os `Runner`s são casados com eles aqui
   * (#203) — por id quando o snapshot os tem, ou o legado de um dono só para o único que há.
   * Um snapshot anterior a #160 traz a lista plana: os containers ganham os tamanhos aqui.
   */
  onResume(session: Session): void {
    const pending = this.#pendingRunners;
    this.#pendingRunners = null;
    for (const character of session.participants) {
      character.inventory.ensureContainers(this.#containerRules(character));
      // SÓ reinstala o observer (ADR 0032 d.8): a fila restaurada já tem o `EQUIP_EXPIRE`, e
      // reagendar aqui duplicaria o evento e o item venceria cedo. Snapshot anterior sem o
      // evento é degradação declarada — o item só volta a vencer quando for reequipado.
      character.inventory.setEquipmentObserver(this.#equipmentObserver(session, character.id));
      if (this.#runners.has(character.id)) continue;
      const state = pending?.byId?.[character.id]
        ?? (pending?.byId === null && session.participants.length === 1 ? pending.legacy : null)
        ?? null;
      // A configuração volta CRUA e é recompilada (FUN-81). Sem isto, uma hunt retomada roda
      // sem bot: continua andando e matando com o ataque básico, então nada PARECE quebrado —
      // o que some é a cura, e o jogador descobre pelo personagem morto. As regras de SAÍDA
      // vêm junto, pela mesma razão.
      this.#runners.set(character.id, this.#newRunner(state?.botConfig, state ?? undefined, character));
      // O mundo mudou enquanto a sessão estava parada: o que estava ENGATILHADO reavalia agora.
      // O que estava AGENDADO tem evento na fila restaurada e `#armBot` o pula — nunca os dois.
      if (character.alive) {
        this.#autoSelectTarget(session, character);
        this.#armBot(session, character.id);
      }
    }
    // A reserva é DERIVADA e não vai no snapshot (DT-02): o primeiro rebalanceamento depois de
    // retomar sai daqui, quando os participantes já existem. Chamá-lo em `restore` quebraria
    // porque lá `session.participants` ainda está vazio.
    if (this.#bag !== null) this.#rebalanceBag(session);
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
    // Os cadáveres voltam com o snapshot; o prazo de cada um é o evento `CORPSE`, que a fila
    // da sessão já trouxe de volta (FUN-123).
    this.#corpses = [...(restored.corpses ?? [])];
    // Os campos voltam indexados por tile (CMB-07); os eventos de tique e vencimento já vêm na
    // fila serializada. Ausente é nenhum — snapshot anterior a esta issue.
    this.#fields = Fields.fromState(restored.fields);
    this.#nextGroundItemId = restored.nextGroundItemId ?? 1;
    this.#staminaAnchorMs = restored.staminaAnchorMs;
    // Migração na LEITURA (DT-02): snapshot antigo traz `{mode}`, o novo traz os eixos. Sem bump.
    this.#party = normalizePartyOptions(restored.partyOptions);
    // A votação de encerrar volta com quem já aprovou (#432); o vencimento já está na fila do
    // snapshot. Ausente é nenhuma votação — snapshot anterior a esta issue.
    this.#endVote = restored.endVote === undefined
      ? null
      : { proposedAtMs: restored.endVote.proposedAtMs, approved: new Set(restored.endVote.approved) };
    // A bolsa também migra na leitura (D5): o formato antigo (`gold: number`) vira entradas com
    // `eligible: []`, o sentinel de "presentes no settlement" — a regra de hoje, para uma sessão
    // em voo não perder nem confiscar o que já estava na bolsa.
    const restoredBag = restored.partyBag as unknown;
    this.#bag = restoredBag === undefined
      ? (this.#party?.splitLoot ? { gold: [], items: [], capacity: 0, overweight: false } : null)
      : isLegacyBag(restoredBag)
        ? {
            gold: restoredBag.gold > 0 ? [{ amount: restoredBag.gold, eligible: [] }] : [],
            items: restoredBag.items.map((item) => ({ item, eligible: [] })),
            capacity: restoredBag.capacity,
            // Snapshot anterior ao #396: sem a flag, o primeiro rebalanceamento a recalcula.
            overweight: false,
          }
        : {
            gold: [...(restoredBag as PartyBagState).gold],
            items: (restoredBag as PartyBagState).items.map(
              (entry) => ({ item: entry.item, eligible: [...entry.eligible] }),
            ),
            capacity: (restoredBag as PartyBagState).capacity,
            // Opcional na leitura: snapshot anterior ao #396 não tem a chave.
            overweight: (restoredBag as PartyBagState).overweight ?? false,
          };
    // O peso é derivado; o próximo id de instância continua depois do maior que já existe.
    this.#bagWeight = 0;
    this.#bagSeq = 0;
    for (const entry of this.#bag?.items ?? []) {
      this.#bagWeight += (this.#options.items.get(entry.item.itemId)?.weight ?? 0) * entry.item.quantity;
      const n = Number(entry.item.instanceId.split(':').at(-1));
      if (Number.isFinite(n) && n >= this.#bagSeq) this.#bagSeq = n + 1;
    }
    // O estado por participante espera `onResume` (#203): os participantes ainda não existem —
    // a `Session` os reconstrói depois desta chamada. Sem `runners` é o snapshot de um dono
    // só, e os campos soltos são dele. Sem isto, uma hunt retomada no meio de um lure de
    // vinte monstros recomeçaria "correndo" e continuaria juntando por cima do que já estava.
    this.#runners.clear();
    this.#pendingRunners = {
      byId: restored.runners ?? null,
      legacy: {
        route: restored.route,
        botScheduled: restored.botScheduled ?? [],
        luring: restored.luring ?? true,
        ringReplaced: restored.ringReplaced ?? null,
        playerAttackReady: restored.playerAttackReady ?? true,
        warnedExhausted: restored.warnedExhausted,
        warnedFullBackpack: restored.warnedFullBackpack ?? false,
        warnedNoGold: restored.warnedNoGold ?? false,
        ...(restored.botConfig === undefined ? {} : { botConfig: restored.botConfig }),
      },
    };
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
      (pointIndex) => {
        const point = this.#options.route.spawnPoints[pointIndex] as SpawnPoint;
        return { at: point.at, radius: point.radius };
      },
      this.#spawnBlockedFor(session),
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
    // A básica nasce engatilhada e vence AGORA, como sempre (CMB-06). As abilities DECLARADAS
    // são armadas pelo primeiro passo, que já reavalia a distância — agendá-las aqui seria um
    // evento por ability por monstro nascendo, para quase sempre não achar alvo.
    if (definition.abilities.some((ability) => ability.id === BASIC_ABILITY_ID)) {
      this.#scheduleMonsterAttack(session, monster, 0);
    }
    // Nasceu colado num personagem: se o golpe dele estava engatilhado, sai agora — de cada
    // um que o tem ao alcance (#203). E o auto-target (#444) reavalia na hora: o monstro que
    // acabou de surgir na tela vira alvo antes do próximo vencimento do bot.
    for (const character of session.participants) {
      this.#autoSelectTarget(session, character);
      this.#armPlayerAttack(session, character);
      this.#armBot(session, character.id);
    }
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
    // Andou (ou parou para lutar): reavalia o alvo na tela da posição nova e acorda o bot —
    // um monstro que entrou no raio de busca pode destravar a runa (#444).
    this.#autoSelectTarget(session, character);
    this.#armBot(session, character.id);
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
    const runner = this.#runnerOf(character.id);
    if (this.#attackTarget(character) !== null && !this.#luring(runner, character)) {
      runner.walker.stop();
      this.#armPlayerAttack(session, character);
      return null;
    }

    // Follow de membro (ADR 0035 d.9, §D10, #398): substitui a rota E a postura contra monstro
    // enquanto ativo. O combate já rodou acima — é ele, não isto, que decide se o personagem
    // para para bater; seguir não impede atacar quem estiver ao alcance da arma.
    const follow = this.#holdFollow(session, runner, character);
    if (follow !== false) {
      this.#armPlayerAttack(session, character);
      return follow;
    }

    // Ninguém ao alcance, e a postura pode mandar ele SAIR DA ROTA atrás do alvo (FUN-85).
    // Com `stand` — o padrão — isto não roda, e o comportamento é o de sempre.
    const posture = this.#holdPosture(session, runner, character);
    if (posture !== false) {
      this.#armPlayerAttack(session, character);
      return posture;
    }

    // Ninguém ao alcance: anda. Com postura `stand` o personagem NÃO persegue — ele percorre a
    // rota e deixa o monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
    runner.walker.resume();
    const to = runner.walker.step();
    if (to === null) return null;
    let result = this.#step(session, character, to, character.id);
    if (!result.ok) {
      if (result.reason === 'not-adjacent') {
        // O personagem não está onde a rota acha que ele está — andou à mão (FUN-69) ou foi
        // empurrado. Reentrar pelo tile mais próximo, em vez de segurar um índice que nunca
        // mais vai ficar adjacente.
        runner.walker.rejoinNearest(character.position);
      } else if (this.#companionAt(session, character, to)) {
        // Um COMPANHEIRO parado na rota (#203): ele está lutando ali, e esperar seria ficar
        // atrás dele a hunt inteira — foi o que aconteceu. Contorna com o passo guloso rumo
        // ao tile seguinte; o vencimento seguinte reentra pela rota (`not-adjacent` →
        // `rejoinNearest`). Cercado, segura como faria com um monstro.
        const around = greedyStep(character.position, runner.walker.ahead(), this.#blockedFor(character));
        if (around === null) {
          runner.walker.hold();
        } else {
          runner.walker.hold();
          result = this.#step(session, character, { ...around, z: character.position.z }, character.id);
        }
      } else {
        // Rota bloqueada por monstro é normal, e o walker precisa saber: sem `hold` o índice
        // avançaria e o personagem "pularia" o tile ocupado na volta seguinte.
        runner.walker.hold();
      }
    }
    this.#armPlayerAttack(session, character);
    return result;
  }

  /** Há OUTRO participante vivo parado em `at`? É o bloqueio que se contorna, não se espera. */
  #companionAt(session: Session, self: CharacterRuntime, at: GridPoint): boolean {
    for (const other of session.participants) {
      if (other === self || !other.alive) continue;
      if (other.position.x === at.x && other.position.y === at.y) return true;
    }
    return false;
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
  #holdPosture(session: Session, runner: Runner, character: CharacterRuntime): MoveResult | null | false {
    const posture = targetingOf(runner).posture;
    if (posture.kind === 'stand') return false;

    const target = this.#approachTarget(character);
    if (target === null) return false;

    const from = character.position;
    const d = distance(from, target.position);
    const blocked = this.#blockedFor(character);
    // `follow` persegue até poder bater; `keep-distance` mira a distância configurada. Os dois
    // são o mesmo cálculo com alvos diferentes, e escrever dois laços seria a mesma geometria
    // divergindo na terceira mudança.
    const want = posture.kind === 'follow' ? this.#attackRangeOf(character) : posture.tiles;
    // `null` é "a postura decidiu ficar parado": a cadência seguinte é a de um passo daqui.
    if (d === want) return null;

    const to = d > want
      ? greedyStep(from, target.position, blocked)
      : fleeStep(from, target.position, blocked);
    // Empacado — cercado, ou contra a parede recuando. Esperar é o comportamento certo, e é o
    // mesmo que o passo guloso do monstro já faz (ADR 0009).
    if (to === null) return null;

    runner.walker.stop();
    return this.#step(session, character, { ...to, z: from.z }, character.id);
  }

  /**
   * Follow de membro (ADR 0035 d.9, §D10, #398). Passo guloso até ficar ADJACENTE (distância 1,
   * Chebyshev — a mesma grade do resto do movimento) do alvo configurado; parado quando já está.
   *
   * `kind: 'leader'` resolve `#leader(session)` a CADA vencimento — nunca guarda o id — pela
   * mesma razão de `#approachTarget` nunca guardar o monstro escolhido: a mira certa é a de
   * agora. `#leader` já cai para o mais antigo presente quando o líder muda (#394), então uma
   * troca de liderança no meio da hunt já reflete aqui sem nenhum código extra.
   *
   * Devolve `false` quando não há follow ativo — E quando o follow está INTERROMPIDO —, para
   * `#playerStep` cair na postura contra monstro e na rota, exatamente como sem follow nenhum.
   */
  #holdFollow(session: Session, runner: Runner, character: CharacterRuntime): MoveResult | null | false {
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return false;

    const targetId = follow.kind === 'leader' ? (this.#leader(session)?.id ?? null) : follow.characterId;
    const target = targetId === null ? null : findById(session.participants, targetId);

    // Alvo ausente: nunca deveria chegar aqui por morte ou saída — `#interruptFollowersOf` já
    // reportou no MESMO evento em que o alvo saiu (`onLeave`) —, mas cair no mesmo `false` por
    // segurança nunca escolhe outro, que é a garantia que importa.
    if (target === null || target.id === character.id) return false;

    const from = character.position;
    const d = distance(from, target.position);
    const radius = this.#options.targetSearchRadius ?? 8;

    if (d > radius) {
      this.#reportFollow(session, runner, character.id, target.id, false, 'unreachable');
      return false;
    }
    // Em alcance: reporta a RETOMADA se estava interrompido (não-op se já estava ativo). Fica
    // ANTES do "já adjacente" porque retomar e já estar adjacente são independentes: o alvo pode
    // ter voltado ao alcance parado.
    this.#reportFollow(session, runner, character.id, target.id, true);

    if (d === 1) return null;

    const to = greedyStep(from, target.position, this.#blockedFor(character));
    // Empacado — mesmo comportamento de `#holdPosture`: esperar este vencimento, não é
    // interrupção. "Sem caminho" vira `unreachable` só pela DISTÂNCIA (acima), não por um passo
    // bloqueado — senão contornar uma parede piscaria o follow a cada vencimento.
    if (to === null) return null;

    runner.walker.stop();
    return this.#step(session, character, { ...to, z: from.z }, character.id);
  }

  /**
   * Emite `follow-state` só na TRANSIÇÃO (§D10: "uma vez"). `runner.followInterrupted` é o que
   * faz cada chamada custar uma comparação em vez de um evento — `#holdFollow` chama isto a CADA
   * vencimento enquanto o alvo está em alcance, e só a primeira depois de uma mudança produz
   * `session.emit`.
   */
  #reportFollow(
    session: Session, runner: Runner, characterId: string, targetId: string, active: boolean,
    reason?: 'dead' | 'left' | 'unreachable',
  ): void {
    // A verdade ATUAL é gravada ANTES do curto-circuito de transição: o evento só sai uma vez,
    // mas o `followStateOf` precisa responder "onde o Follow está agora" mesmo quando nada mudou
    // desde o último vencimento (#401).
    runner.followTargetId = targetId;
    runner.followReason = active ? undefined : reason;
    if (runner.followInterrupted === !active) return;
    runner.followInterrupted = !active;
    session.emit({
      kind: 'follow-state', characterId, targetId, active,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  /**
   * O estado ATUAL do Follow de um personagem (#401), para o hospedeiro reenviar a quem
   * reconecta. O evento `follow-state` só é emitido na TRANSIÇÃO (#398), e sem visualizador ele
   * é descartado pelo hospedeiro — esta leitura síncrona é o que faz a verdade sobreviver ao
   * descarte (invariante 3), em vez de o host guardar uma segunda cópia do estado.
   *
   * `undefined` sem Follow configurado (`kind: 'none'`) ou sem alvo resolvido ainda — os dois
   * casos em que o cliente não tem nada a corrigir.
   */
  followStateOf(characterId: string): {
    readonly active: boolean;
    readonly targetId: string;
    readonly reason?: 'dead' | 'left' | 'unreachable';
  } | undefined {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) return undefined;
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return undefined;
    const targetId = runner.followTargetId
      ?? (follow.kind === 'member' ? follow.characterId : this.#party?.leaderId);
    if (targetId === undefined) return undefined;
    const active = !runner.followInterrupted;
    return {
      active,
      targetId,
      ...(active || runner.followReason === undefined ? {} : { reason: runner.followReason }),
    };
  }

  /**
   * O alvo de um follow saiu da sessão (§D10, #398): quem o seguia é interrompido AGORA, no mesmo
   * evento da saída — é o único lugar em que dá para diferenciar `'dead'` de `'left'`, porque
   * `character.alive` já está `false` antes de `onLeave` rodar. `kind: 'leader'` usa
   * `this.#party?.leaderId` — o valor de ANTES desta saída, porque #394 só o reescreve depois, em
   * `#flushLoss` — para saber se o `departed` ERA o líder.
   */
  #interruptFollowersOf(session: Session, departed: CharacterRuntime): void {
    const reason = departed.alive ? 'left' : 'dead';
    const wasLeader = departed.id === this.#party?.leaderId;
    for (const [followerId, runner] of this.#runners) {
      const follow = runner.botConfig?.follow;
      if (follow === undefined || follow.kind === 'none') continue;
      const followedId = follow.kind === 'leader'
        ? (wasLeader ? departed.id : null)
        : follow.characterId;
      if (followedId !== departed.id) continue;
      this.#reportFollow(session, runner, followerId, departed.id, false, reason);
    }
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
  configureBot(session: Session, config: BotConfigInput, characterId?: string): void {
    // De QUEM (#203): por id, ou o primeiro participante — o caminho solo de sempre.
    const character = characterId === undefined
      ? session.participants[0]
      : findById(session.participants, characterId) ?? undefined;
    if (character === undefined) return;
    const runner = this.#runnerOf(character.id);
    // v1 no boundary vira v2 (DT-02); a config guardada é a v2, para o snapshot já sair no
    // vocabulário novo.
    const normalized = migrateBotConfigV1(config);
    runner.botConfig = normalized;
    runner.bot = compileBot(normalized, this.#cooldownOf);
    runner.automations = compileAutomations(normalized.automations);
    runner.actuator = this.#automationActuatorFor(runner, character);
    // Grupo NOVO (a config antiga não o tinha) nasce ENGATILHADO: `#armBot` só toca os
    // engatilhados, e sem esta linha a regra recém-configurada nunca acordaria.
    for (const group of runner.bot.groups.keys()) {
      if (runner.botReady[group] === undefined) runner.botReady[group] = true;
    }
    runner.exitRules = this.#composeExitRules(normalized);
    // Grupo que ganhou regra agora precisa acordar. `#armBot` só toca os ENGATILHADOS, e os
    // que já tinham evento pendente seguem com ele — a invariante "engatilhado ou agendado"
    // continua valendo do outro lado de uma troca de configuração. Um grupo que SAIU da config
    // tem `botReady` órfão, e o evento pendente dele vence sem achar slots: não faz nada.
    if (character.alive) {
      this.#autoSelectTarget(session, character);
      this.#armBot(session, character.id);
      this.#armAutomations(session, character.id);
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
      this.#runnerOf(characterId).playerAttackReady = true;
      return;
    }

    this.#schedulePlayerAttack(session, characterId, this.#options.player.attackIntervalMs);
    const weapon = character.inventory.weapon(this.#options.items, character);
    const how = weapon?.weapon;
    // Wand sem mana NÃO bate (#152): o golpe fica agendado para o intervalo seguinte, e sai
    // quando a mana tiver voltado. Não consome mana, não rende skill — como a magia recusada.
    if (how?.kind === 'wand' && character.mana < (how.manaPerHit ?? 0)) return;
    this.#strike(session, character, target, weapon, how);
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
    this.#runnerOf(characterId).playerAttackReady = false;
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
   * Um grupo do bot venceu: percorre os slots na ORDEM da barra (RP-002) e executa o primeiro
   * ELEGÍVEL (RP-001). O inelegível é PULADO no MESMO ciclo (RP-003/RP-004).
   *
   * O reagendamento depende do que aconteceu, e a distinção importa:
   *
   * - **executou** → volta no cooldown do GRUPO (do conteúdo), não num 1 s fixo. É o rate limit
   *   do ADR 0032 d.2, e ele conta a partir da AÇÃO, não do relógio de parede;
   * - **nenhum slot elegível** → ENGATILHA, exceto a recusa por COOLDOWN, que volta no
   *   vencimento do livro que trancou. Um grupo que reagenda no vazio é um evento por segundo
   *   por personagem gasto para descobrir que não há nada a fazer.
   *
   * Atuador que recusa (sem mana, sem item, sem alvo) NÃO consome o cooldown: o próximo slot do
   * MESMO grupo tenta agora (RP-004). Sem mana não melhora com o tempo passar, então a recusa
   * por falta ENGATILHA ao fim do laço.
   */
  #onBot(session: Session, group: string, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null) return;
    const runner = this.#runnerOf(characterId);
    runner.botReady[group] = true;
    const bot = runner.bot;
    if (bot === undefined || !character.alive) return;

const slots = bot.groups.get(group);
    if (slots === undefined) return;
    // A view é montada UMA vez por vencimento: todos os slots do grupo decidem sobre o MESMO
    // instante. Reavaliar por slot depois de uma recusa é o atuador que decide, não o mundo.
    // O alcance é o do GRUPO (#444): um grupo com runa enxerga a 8, não no alcance da arma.
    const reach = this.#groupRange(slots, character);
    const view = this.#botViewOf(character, reach);
    const external = this.#options.actuator;

    let retryInMs = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i] as CompiledSlot;
      // O `targets` é da AÇÃO avaliada, não do grupo (#480): uma runa de área conta quem cai
      // no FOOTPRINT dela sobre o alvo primário, e uma ação sem área no alcance. Recalcular
      // por slot evita que o slot seguinte herde a contagem do anterior — a view é a mesma, o
      // instante é o mesmo, só a mira muda.
      view.targetCount = this.#targetCountFor(
        character, reach, this.#actionArea(slot.act), this.#actionRange(slot.act),
      );
      // Alvo != self resolve o RECIPIENTE ANTES de avaliar: a condição `hp` lê o CANDIDATO, e o
      // slot pode valer para ele mesmo com o lançador de vida cheia (§26-30, ADR 0035 d.10).
      // Tenta os candidatos NA ORDEM em que chegaram (já rankeada por `#resolveRuleTarget`) e
      // para no primeiro cujo `when` vale — o "usa o primeiro válido" do §29.
      let recipient = character;
      if (slot.target.kind !== 'self') {
        const candidates = this.#resolveRuleTarget(session, character, slot);
        let matched = false;
        for (let j = 0; j < candidates.length; j += 1) {
          const candidate = candidates[j] as CharacterRuntime;
          view.partyTarget = candidate;
          if (slot.when(view)) { recipient = candidate; matched = true; break; }
        }
        view.partyTarget = null;
        if (!matched) continue;
      } else {
        view.partyTarget = null;
        if (!slot.when(view)) continue;                  // condição falsa → PULA (RP-003)
      }
      if (external !== undefined) {
        if (!external.perform(slot.act, view)) continue; // recusou → próximo no mesmo ciclo
        this.#scheduleBot(session, group, characterId, this.#botCooldownMs());
        return;
      }
      const result = this.#perform(session, character, slot.act, recipient);
      if (result.ok) {
        // O grupo trancou: o próximo vencimento é o cooldown DELE (do conteúdo), não um 1 s
        // fixo. A magia já iniciou `group:<g>` no `castSpell`; o item sem livro cai no fallback.
        const wait = character.cooldowns.remainingMs(slot.cooldownKey, session.nowMs);
        this.#scheduleBot(session, group, characterId, wait > 0 ? wait : this.#botCooldownMs());
        // A ação mudou HP, mana ou gold: o que está engatilhado reavalia AGORA, sobre o mundo
        // já resolvido. Uma poção de mana que não acorda a cura é o bot esperando dano novo
        // para usar a mana que acabou de repor.
        this.#armBot(session, characterId);
        // As automações (AB-08) reagem ao mesmo mundo: o anel sai quando a cura devolve o HP,
        // ou quando a magia derruba a mana abaixo do piso — os dois lados da máquina do §13.8
        // dependem do que a ação acabou de mudar.
        this.#armAutomations(session, character.id);
        return;
      }
      // Recusa: o próximo slot do MESMO grupo tenta agora. Só a recusa por COOLDOWN carrega
      // prazo; ela é lembrada para o reagendamento caso nenhum outro slot execute.
      if (result.retryInMs > retryInMs) retryInMs = result.retryInMs;
    }
    // Nenhum elegível: recusa por cooldown volta no vencimento; as outras ENGATILHAM.
    if (retryInMs > 0) this.#scheduleBot(session, group, characterId, retryInMs);
  }

  /**
   * Executa a ação escolhida pelo bot (FUN-74, FUN-77).
   *
   * É o `BotActuator` embutido, e mora aqui — e não numa classe à parte — porque tudo o que
   * ele precisa é da hunt: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o
   * pipeline de morte. Uma classe separada receberia os quatro por parâmetro e não ganharia
   * nada em troca.
   */
  #perform(
    session: Session, character: CharacterRuntime, action: BotAction,
    recipient: CharacterRuntime = character,
  ): CastResult {
    switch (action.kind) {
      case 'spell': return this.#castSpell(session, character, action.spellId, recipient);
      case 'supply': return this.#useSupply(session, character, action.supplyId, recipient);
      // O item de slot saiu no vocabulário v2 (AB-03): o consumível abstrato é `supply`, com
      // gold no uso, e o item de equipamento é das automações.
      case 'item': return NOT_IN_CATALOG;
    }
  }

  /**
   * Alcance do EFEITO de cura da ação — nunca o de ataque. `null` quando a ação não é magia/
   * supply de cura, OU o efeito é `self`-only: é a checagem em profundidade do RF-05
   * (`validateBotConfig` já recusa a combinação na configuração; aqui a resposta é "sem
   * candidato", nunca uma exceção — a mesma filosofia de toda outra recusa deste arquivo).
   */
  #healRangeOf(action: BotAction): number | null {
    if (action.kind === 'spell') {
      const effect = this.#options.spells.get(action.spellId)?.effect;
      if (effect === undefined || effect.kind !== 'heal' || effect.target !== 'friend') return null;
      return effect.range ?? null;
    }
    if (action.kind === 'supply') {
      const effect = this.#options.supplies.get(action.supplyId)?.effect;
      if (effect === undefined || (effect.kind !== 'heal' && effect.kind !== 'mana')
        || effect.target !== 'friend') {
        return null;
      }
      return effect.range ?? null;
    }
    return null;
  }

  /**
   * Os candidatos de uma regra com alvo != self (D11, ADR 0035 decisão 10).
   *
   * `member` usa SÓ o id pedido: morto, fora da sessão ou fora do alcance devolve lista vazia e
   * a regra não age (§30 — nunca substitui por outro vivo). `lowest-hp-member` devolve todo
   * participante vivo ao alcance ordenado por percentual ASCENDENTE (§28); o próprio lançador
   * entra como candidato de si mesmo, então numa hunt solo "menor vida da party" é ele.
   */
  #resolveRuleTarget(
    session: Session, character: CharacterRuntime, rule: CompiledSlot,
  ): readonly CharacterRuntime[] {
    const range = this.#healRangeOf(rule.act);
    if (range === null) return NO_CANDIDATES;

    if (rule.target.kind === 'member') {
      const member = findById(session.participants, rule.target.characterId);
      if (member === null || !member.alive) return NO_CANDIDATES;
      if (distance(character.position, member.position) > range) return NO_CANDIDATES;
      return [member];
    }

    // `session.participants` já está na ordem de entrada, e `Array#sort` é ESTÁVEL: o desempate
    // cai de graça.
    return session.participants
      .filter((p) => p.alive && distance(character.position, p.position) <= range)
      .sort((a, b) => percentOf(a.health, a.maxHealth) - percentOf(b.health, b.maxHealth));
  }

  /**
   * Acorda o bot de todo participante com ao menos uma regra heal/potion/support de alvo !=
   * self — não só de quem apanhou (RF-06). Custo N por golpe, só com party (ADR 0035,
   * consequências: "aceito").
   */
  #armHealersOf(session: Session): void {
    if (session.participants.length <= 1) return;
    for (const participant of session.participants) {
      const runner = this.#runners.get(participant.id);
      if (runner === undefined || runner.bot === undefined || runner.botConfig === undefined) continue;
      if (hasNonSelfHealRule(runner.botConfig)) this.#armBot(session, participant.id);
    }
  }

  /**
   * Lança a magia. O alvo é o mesmo do golpe — o monstro mais próximo —, e o alcance é o da
   * MAGIA, não o da arma: uma magia de alcance 3 alcança de onde o corpo a corpo não alcança.
   */
  #castSpell(
    session: Session, character: CharacterRuntime, spellId: string,
    recipient: CharacterRuntime = character,
  ): CastResult {
    const spell = this.#options.spells.get(spellId);
    if (spell === undefined) return NOT_IN_CATALOG;

    const aim = spell.effect.kind === 'damage'
      ? this.#aimFor(character, spell.effect.range, spell.effect.area)
      : spell.effect.kind === 'damage-over-time'
        ? this.#aimFor(character, spell.effect.range, undefined)
        : null;
    // Cura em ÁREA (Mass Healing, #475): a forma sai do lançador e os aliados são colhidos
    // ANTES de emitir, como a mira de dano — a ordem dos alvos é contrato de RNG.
    const healArea = spell.effect.kind === 'heal'
      && spell.effect.area !== undefined && isSelfOrigin(spell.effect.area)
      ? this.#collectHealAllies(session, character, spell.effect.area)
      : null;

    const result = castSpell(
      character, spell, aim, session.nowMs, this.#options.combat, session.rng,
      this.#spellScaling(character), recipient,
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
        ? (healArea === null
          ? NO_SPELL_TARGETS
          : this.#healAllies.map((ally) => ({ creatureId: ally.id, position: this.#at(ally) })))
        : this.#spellHits.map((m) => ({ creatureId: m.subject, position: this.#at(m) })),
      // Os tiles da forma (#155): vetor NOVO pela razão de `targets`.
      tiles: aim === null ? (healArea ?? NO_TILES) : [...this.#aimTiles],
    });
    // Condição (#155, CMB-07): o `castSpell` devolve, e quem agenda é quem tem a fila. O DOT
    // mira o ALVO principal da mira; haste, postura, magic shield e Recovery valem no LANÇADOR.
    if (result.condition !== undefined) {
      const target: ConditionTarget | undefined = result.condition.tick?.kind === 'damage'
        ? this.#spellHits[0]
        : character;
      if (target !== undefined) {
        this.#applyConditionTo(session, target, {
          ...result.condition,
          targetId: this.#subjectOf(target),
          sourceId: character.id,
        });
      }
      return result;
    }
    if (aim === null) {
      // o efeito prometia — e de vida cheia é zero, sem número nenhum a flutuar. O anúncio é do
      // RECIPIENT: curar um amigo acende a barra dele, não a de quem lançou. O HPS, ao
      // contrário, é de QUEM lançou (#431) — por isso o `character.id` como curador.
      this.#emitHealed(session, recipient, result.healed, 'spell', character.id);
      // Mass Healing: os ALIADOS na forma, um a um, na ordem dos participantes. Cada um consome
      // uma rolagem (o contrato do dano em área), e o conjurador é pulado porque o `castSpell`
      // já o curou. Overheal rende zero e nenhum evento sai.
      if (healArea !== null && spell.effect.kind === 'heal') {
        const scaling = this.#spellScaling(character);
        for (const ally of this.#healAllies) {
          if (ally === character || !ally.alive) continue;
          const healed = executeHealing(
            character, ally, spell.effect, scaling, this.#options.combat, session.rng,
          );
          this.#emitHealed(session, ally, healed, 'spell', character.id);
        }
      }
      return result;
    }

    this.#applyHits(
      session, character, result.hits,
      spell.effect.kind === 'damage' ? spell.effect.damageType : undefined,
    );
    return result;
  }

  /**
   * Colhe os aliados de uma cura em área (#475): os participantes VIVOS cujo tile cai na forma
   * centrada no lançador, na ordem de `session.participants`. Devolve os tiles para o evento e
   * guarda os alvos em `#healAllies` — a mesma divisão de `#aimFor`.
   *
   * Só personagens entram: Mass Healing cura jogadores (e invocações, que o motor ainda não
   * tem), nunca monstros. A ordem é contrato, como a da área de dano.
   */
  #collectHealAllies(
    session: Session, character: CharacterRuntime, area: SpellArea,
  ): readonly WorldPoint[] {
    const tiles = areaTiles(area, character.position, character.direction);
    this.#healAllies.length = 0;
    const keys = new Set(tiles.map(tileKey));
    for (const participant of session.participants) {
      if (!participant.alive) continue;
      if (!keys.has(tileKey(this.#at(participant)))) continue;
      this.#healAllies.push(participant);
    }
    return tiles;
  }

  /**
   * Aplica os golpes de uma mira — magia (FUN-92) ou runa (#165) — depois de colher TODOS os
   * alvos, e não durante.
   *
   * `#onMonsterDied` faz `this.#monsters = this.#monsters.filter(...)`: resolver morte no
   * meio de uma varredura sobre `#monsters` é varrer um array que está sendo trocado, e os
   * alvos depois do que morreu ficariam de fora. Colher primeiro fecha essa porta.
   * Nenhum monstro entra duas vezes na mesma mira — o principal é excluído do laço da forma —,
   * então não há como um deles já estar morto quando chega a vez dele. Uma conferência de
   * `alive` aqui seria código que nenhum teste alcança.
   */
  #applyHits(
    session: Session, character: CharacterRuntime, hits: readonly number[],
    damageType: DamageType | undefined,
  ): void {
    for (let i = 0; i < this.#spellHits.length; i += 1) {
      const monster = this.#spellHits[i] as MonsterRuntime;
      const damage = hits[i] ?? 0;
      // Por ALVO, não a soma da área: "maior hit" é o maior golpe que alguém levou, e somar
      // uma área faria uma magia fraca em cinco alvos superar a mais forte do jogo em um.
      session.credit(character.id, 'bestSpellHit', damage);
      // Aplicar é também ATRIBUIR: o dano de magia conta para quem matou, como o do golpe.
      const applied = monster.receiveDamage(damage);
      // O DPS soma o APLICADO (#431), pela mesma razão do `#land`: a manopla do overkill não
      // entra na conta do dano causado.
      session.creditDamage(character.id, applied);
      recordDamage(monster.contribution, character.id, applied);
      // O golpe antes da barra, com o APLICADO — a mesma regra do `#strike`. O elemento
      // (#479) vai junto quando a magia o declara: é ele que escolhe a cor do número.
      session.emit({
        kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
        amount: applied, source: 'spell', position: this.#at(monster),
        ...(damageType === undefined ? {} : { damageType }),
      });
      this.#emitHealth(session, monster);
      if (!monster.alive) resolveDeath(session, { kind: 'monster', monster });
    }
  }

  /**
   * Colhe quem a magia atinge (FUN-92, #155): o alvo principal primeiro, depois quem cai na
   * forma. Sem área é alvo único — um caso do mesmo caminho, e não um ramo à parte.
   *
   * Duas famílias de forma (referência §19): a centrada no ALVO (alvo único, círculo no alvo)
   * passa por `selectTarget` com o alcance da MAGIA — não o da arma, que era o defeito da
   * FUN-74 —, e a que sai do LANÇADOR (onda, cleave, feixe, círculo em volta) não tem alvo
   * nem alcance: os tiles saem da posição e da DIREÇÃO do personagem, e `distance` vem zero.
   *
   * A ordem é CONTRATO: cada alvo consome uma rolagem do `Rng` da sessão, e ela é a ordem da
   * lista de monstros, que é a de nascimento. Trocar a ordem troca qual sorteio cai em quem, e
   * a mesma semente passa a render uma hunt diferente.
   *
   * Os vetores são REAPROVEITADOS, como `#botView` e `#spellTarget`. A única alocação por
   * lançamento é o `Set` de chaves da forma, do tamanho dela.
   */
  #aimFor(
    character: CharacterRuntime, range: number | undefined, area: SpellArea | undefined,
  ): SpellAim | null {
    this.#spellHits.length = 0;
    this.#spellTargets.length = 0;
    this.#aimTiles = [];

    if (area !== undefined && isSelfOrigin(area)) {
      this.#aimTiles = areaTiles(area, character.position, character.direction);
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.#monsters) {
        if (!monster.alive || !keys.has(tileKey(this.#at(monster)))) continue;
        this.#collect(monster);
      }
      if (this.#spellHits.length === 0) return null;
      this.#aim.distance = 0;
      this.#aim.targets = this.#spellTargets;
      return this.#aim;
    }

    const primary = this.#targetInRange(character, range);
    if (primary === null) return null;
    this.#collect(primary);

    if (area !== undefined) {
      this.#aimTiles = areaTiles(area, character.position, character.direction, this.#at(primary));
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.#monsters) {
        if (monster === primary || !monster.alive) continue;
        if (!keys.has(tileKey(this.#at(monster)))) continue;
        this.#collect(monster);
      }
    }

    this.#aim.distance = distance(character.position, primary.position);
    this.#aim.targets = this.#spellTargets;
    return this.#aim;
  }

  /** O que escala a runa (#165): a skill `magic` de toda vocação, sem o multiplicador por uso (o BP já a conta). */
  #runeScaling(character: CharacterRuntime): SpellScaling {
    const magic = this.#options.skills.get('magic');
    const magicLevel = magic === undefined ? 0 : character.skills.levelOf(magic);
    return { skillLevel: magicLevel, powerScale: 1, magicLevel };
  }

  /** O que escala a magia deste personagem (#155): a skill da vocação (`spellSkill`), e as por uso. */
  #spellScaling(character: CharacterRuntime): SpellScaling {
    const skillId = this.#vocationOf(character)?.spellSkill ?? 'magic';
    const skill = this.#options.skills.get(skillId);
    const magic = this.#options.skills.get('magic');
    return {
      skillLevel: skill === undefined ? 0 : character.skills.levelOf(skill),
      // A skill de magia escala o poder FIXO, como a de arma escala o golpe (FUN-75).
      powerScale: this.#scaledPower(character, 'spell-cast', 1),
      // A fórmula canônica de CURA (#475) escala pelo magic level, em toda vocação.
      magicLevel: magic === undefined ? 0 : character.skills.levelOf(magic),
      // O termo de arma da fórmula baseada em `attack` (#523: Groundshaker, Berserk, Fierce
      // Berserk, Front Sweep, Whirlwind Throw). `0` desarmado — a mesma resposta honesta de
      // `weaponAttack`, nunca um número inventado.
      weaponAttack: character.inventory.weaponAttack(this.#options.items, character) ?? 0,
    };
  }

  /**
   * Aplica uma condição a um ALVO — personagem ou monstro (CMB-07) — e agenda o vencimento e o
   * tique. Relançar segue a política `merge` declarada: o evento antigo é cancelado ANTES do
   * novo agendamento, sem deixar órfão.
   *
   * Quando `strongest` mantém a condição que já estava, o mapa não muda e NADA é reagendado —
   * comparar a identidade do estado guardado com o que foi passado distingue os dois casos sem
   * um segundo retorno.
   */
  #applyConditionTo(session: Session, target: ConditionTarget, condition: ConditionState): void {
    const subject = conditionSubject(this.#subjectOf(target), condition.key);
    const previous = target.conditions.get(condition.key);
    const tick = tickOf(condition);
    // Só reaproveita o tique quando HÁ de fato um evento pendente na mesma cadência: um
    // `nextTickAtMs` ausente (nenhum tique agendado — o último já rodou) ou vencido não é
    // reaproveitável. Sem este segundo requisito, o relançamento herdaria o fantasma do #334 —
    // um `nextTickAtMs` sem evento correspondente na fila — e a condição relançada nunca mais
    // tiquetaria enquanto fosse renovada.
    const keepTick = previous !== null
      && sameTick(previous, condition)
      && previous.nextTickAtMs !== undefined
      && previous.nextTickAtMs <= previous.expiresAtMs;
    // O `nextTickAtMs` é atualizado aqui para o snapshot; quando o tique é REAPROVEITADO, a
    // cadência antiga continua valendo — é o que impede a inanição do relançamento no mesmo ritmo.
    const nextTickAtMs = tick === null
      ? undefined
      : keepTick
        ? previous!.nextTickAtMs
        : session.nowMs + tick.intervalMs;
    const effective: ConditionState = nextTickAtMs === undefined
      ? condition
      : { ...condition, nextTickAtMs };
    target.conditions.apply(effective);
    // `strongest` manteve o anterior: o evento dele continua valendo, e reagendar duplicaria.
    if (target.conditions.get(condition.key) !== effective) return;
    if (previous !== null) {
      session.cancelEvent(CONDITION_EXPIRE, subject);
      // Relançar no MESMO ritmo NÃO cancela o tique: ele mantém a cadência. Cancelar e
      // reagendar a cada relançamento empurraria o tique para sempre quando as duas cadências
      // coincidem — o DOT que nunca acontece.
      if (!keepTick) session.cancelEvent(CONDITION_TICK, subject);
    }
    session.scheduleIn(CONDITION_EXPIRE, condition.expiresAtMs - session.nowMs, {
      priority: EXPIRE_PRIORITY, subject,
    });
    if (!keepTick && nextTickAtMs !== undefined) {
      session.scheduleIn(CONDITION_TICK, nextTickAtMs - session.nowMs, {
        priority: TICK_PRIORITY, subject,
      });
    }
  }

  #onConditionTick(session: Session, subject: string): void {
    const separator = subject.lastIndexOf('/');
    if (separator < 0) return;
    const target = this.#conditionTargetOf(session, subject.slice(0, separator));
    if (target === null || !target.alive) return;
    const condition = target.conditions.get(subject.slice(separator + 1));
    const tick = condition === null ? null : tickOf(condition);
    if (condition === null || tick === null) return;
    this.#applyConditionTick(session, target, condition, tick);
    // O tique pode ter MATADO o alvo: `#cancelConditions` já removeu a condição e os eventos,
    // e reagendar aqui a ressuscitaria no mapa. Morto não tiqueta.
    if (!target.alive || target.conditions.get(condition.key) === null) return;
    // Reagenda até o prazo: o tique que só caberia DEPOIS de `expiresAtMs` não acontece. O
    // `nextTickAtMs` guardado é o que permite o relançamento reaproveitar a cadência — mas só
    // quando HÁ de fato um evento pendente (#334): sem tique agendado, a chave fica AUSENTE do
    // estado, nunca com um valor fantasma que não corresponde a nenhum evento na fila.
    const nextTickAtMs = session.nowMs + tick.intervalMs;
    if (nextTickAtMs <= condition.expiresAtMs) {
      target.conditions.replace({ ...condition, nextTickAtMs });
      session.scheduleIn(CONDITION_TICK, tick.intervalMs, {
        priority: TICK_PRIORITY, subject,
      });
    } else {
      const { nextTickAtMs: _nextTickAtMs, ...withoutTick } = condition;
      target.conditions.replace(withoutTick);
    }
  }

  #onConditionExpire(session: Session, subject: string): void {
    const separator = subject.lastIndexOf('/');
    if (separator < 0) return;
    this.#conditionTargetOf(session, subject.slice(0, separator))
      ?.conditions.remove(subject.slice(separator + 1));
  }

  /**
   * O tique de uma condição: cura repõe; DANO passa pelo resolver canônico e pelo pipeline de
   * morte (CMB-07) — nunca escrita direta de vida. A atribuição vai para `sourceId` (quem
   * aplicou), e um monstro que cai no tique é resolvido por `resolveDeath`.
   */
  #applyConditionTick(
    session: Session, target: ConditionTarget, condition: ConditionState, tick: NormalizedTick,
  ): void {
    if (!target.alive) return;
    if (tick.kind === 'heal') {
      if (target instanceof CharacterRuntime) {
        // A cura feita é de quem aplicou a condição (`sourceId`), não de quem a carrega (#431).
        this.#emitHealed(session, target, target.heal(tick.amount), 'spell', condition.sourceId);
      }
      return;
    }
    const intent = {
      rawDamage: tick.amount,
      source: tick.source ?? 'monster-attack',
      damageType: tick.damageType ?? 'physical',
    } as const;
    const attacker = condition.sourceId ?? 'field';
    if (target instanceof CharacterRuntime) {
      const outcome = resolveDamage(
        intent, this.#playerDefender(target), 'pve', this.#options.combat, session.rng,
      );
      // CMB-08: o mana shield entra como estágio explícito, e o hit/atribuição usam o HP
      // aplicado. Sem atacante para leech — o DOT não repõe vida de quem o aplicou.
      const applied = applyDamageOutcome(
        target, outcome, null, target.conditions.damageTakenScale(),
        this.#hasEnergyShield(target),
      );
      recordDamage(target.contribution, attacker, applied.healthDamage);
      session.emit({
        kind: 'creature-hit', creatureId: target.id, attackerId: attacker,
        amount: applied.healthDamage, source: 'spell', position: this.#at(target),
        damageType: intent.damageType,
      });
      this.#emitCharacterHealth(session, target);
      if (target.health <= 0) session.kill(target);
      return;
    }
    const definition = this.#options.monsters.get(target.monsterId);
    const outcome = resolveDamage(
      intent,
      { armor: definition?.armor ?? 0, dodgeChance: 0, mitigation: definition?.mitigation },
      'pve', this.#options.combat, session.rng,
    );
    const applied = applyDamageOutcome(target, outcome, null);
    recordDamage(target.contribution, attacker, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: target.subject, attackerId: attacker,
      amount: applied.healthDamage, source: 'spell', position: this.#at(target),
      damageType: intent.damageType,
    });
    this.#emitHealth(session, target);
    if (!target.alive) resolveDeath(session, { kind: 'monster', monster: target });
  }

  /** O alvo de uma condição pelo id: monstro primeiro (`m:<id>`), depois personagem. */
  #conditionTargetOf(session: Session, id: string): ConditionTarget | null {
    const monster = this.#monsterBySubject.get(id);
    if (monster !== undefined) return monster;
    return findById(session.participants, id);
  }

  #subjectOf(target: ConditionTarget): string {
    return target instanceof CharacterRuntime ? target.id : target.subject;
  }

  /**
   * Cancela os eventos das condições de um alvo (CMB-07). Chamado quando ele morre ou sai: sem
   * isto, o vencimento de uma condição de quem não existe mais ficaria na fila até vencer, e o
   * despacho encontraria o vazio — o órfão que o critério da issue proíbe.
   */
  #cancelConditions(session: Session, target: ConditionTarget): void {
    const id = this.#subjectOf(target);
    for (const condition of target.conditions.getState()) {
      const subject = conditionSubject(id, condition.key);
      session.cancelEvent(CONDITION_EXPIRE, subject);
      session.cancelEvent(CONDITION_TICK, subject);
      target.conditions.remove(condition.key);
    }
  }

  // --- campos de tile (CMB-07) ---------------------------------------------------------------

  /**
   * Aplica um campo de tile. O `sim` resolve os tiles da forma AGORA, indexa por chave numérica
   * e agenda tique e vencimento. Relançar o MESMO id reinicia: os eventos antigos são cancelados
   * antes, sem órfão. É a porta ÚNICA — a ability de monstro e o teste passam por aqui.
   *
   * O campo pertence ao ruleset, nunca ao `Tilemap` (DT-01): conteúdo é imutável e fixado.
   */
  applyField(session: Session, spec: FieldSpec, at: WorldPoint): TileFieldState {
    const subject = fieldSubject(spec.id);
    const previous = this.#fields.get(spec.id);
    const interval = specTickIntervalMs(spec.condition);
    // Relançar no MESMO ritmo reaproveita o tique pendente: cancelar e reagendar a cada
    // relançamento empurraria o tique para sempre quando a cadência do campo coincide com a da
    // ability — o mesmo defeito de inanição que o DOT tem. Só o vencimento é sempre reagendado.
    // Mas só reaproveita quando HÁ de fato um evento pendente (#334): um `nextTickAtMs` ausente
    // ou vencido é o fantasma que não corresponde a nenhum evento na fila.
    const keepTick = previous !== null
      && previous.nextTickAtMs !== undefined
      && previous.nextTickAtMs <= previous.expiresAtMs
      && specTickIntervalMs(previous.condition) === interval;
    const nextTickAtMs = interval === null
      ? undefined
      : keepTick
        ? previous!.nextTickAtMs
        : session.nowMs + interval;
    const field: TileFieldState = {
      id: spec.id,
      tiles: areaTiles(spec.shape, at, 'south', at),
      expiresAtMs: session.nowMs + spec.durationMs,
      condition: spec.condition,
      ...(nextTickAtMs === undefined ? {} : { nextTickAtMs }),
    };
    if (previous !== null) {
      session.cancelEvent(FIELD_EXPIRE, subject);
      if (!keepTick) session.cancelEvent(FIELD_TICK, subject);
    }
    this.#fields.apply(field);
    // O vencimento roda ANTES do tique no mesmo instante (prioridade explícita): o tique do
    // instante de expiração encontra o campo removido. Ordem documentada e testada.
    session.scheduleIn(FIELD_EXPIRE, spec.durationMs, {
      priority: EXPIRE_PRIORITY, subject,
    });
    if (!keepTick && nextTickAtMs !== undefined) {
      session.scheduleIn(FIELD_TICK, nextTickAtMs - session.nowMs, {
        priority: TICK_PRIORITY, subject,
      });
    }
    return field;
  }

  #onFieldTick(session: Session, subject: string): void {
    const field = this.#fields.get(subject.slice(2));
    if (field === null) return;
    const interval = specTickIntervalMs(field.condition);
    if (interval === null) return;
    // Quem PISA no campo agora. Um evento por campo, e `at` é O(1) por criatura — nenhum passo
    // varre a lista de campos.
    for (const target of this.#occupants(session, field)) {
      const condition = conditionFromSpec(
        field.condition, this.#subjectOf(target), field.id, session.nowMs, 'monster-attack',
      );
      const tick = tickOf(condition);
      if (tick !== null) this.#applyConditionTick(session, target, condition, tick);
    }
    // Reagenda até o prazo, e guarda o `nextTickAtMs` (#334) pelo mesmo motivo do tique de
    // condição: sem tique agendado, a chave fica AUSENTE, nunca com um valor fantasma.
    const nextTickAtMs = session.nowMs + interval;
    if (nextTickAtMs <= field.expiresAtMs) {
      this.#fields.replace({ ...field, nextTickAtMs });
      session.scheduleIn(FIELD_TICK, interval, {
        priority: TICK_PRIORITY, subject,
      });
    } else {
      const { nextTickAtMs: _nextTickAtMs, ...withoutTick } = field;
      this.#fields.replace(withoutTick);
    }
  }

  #onFieldExpire(session: Session, subject: string): void {
    this.#fields.remove(subject.slice(2));
  }

  /** Quem está sobre os tiles do campo: participantes e monstros vivos. */
  #occupants(session: Session, field: TileFieldState): ConditionTarget[] {
    const occupants: ConditionTarget[] = [];
    for (const character of session.participants) {
      if (!character.alive) continue;
      if (this.#fields.at(this.#at(character))?.id === field.id) occupants.push(character);
    }
    for (const monster of this.#monsters) {
      if (!monster.alive) continue;
      if (this.#fields.at(this.#at(monster))?.id === field.id) occupants.push(monster);
    }
    return occupants;
  }

  /**
   * A entrada num campo, observada SÓ depois de um passo aceito (`#step`). Refusão de tile não
   * chega aqui — `movement` devolve resultado e não infringe dano (CMB-07). Aplica UM tique.
   */
  #enterField(session: Session, target: ConditionTarget): void {
    const field = this.#fields.at(this.#at(target));
    if (field === null) return;
    const condition = conditionFromSpec(
      field.condition, this.#subjectOf(target), field.id, session.nowMs, 'monster-attack',
    );
    const tick = tickOf(condition);
    if (tick !== null) this.#applyConditionTick(session, target, condition, tick);
  }

  /** Põe o monstro na mira, com a armadura e a mitigação que o conteúdo dá a ele. */
  #collect(monster: MonsterRuntime): void {
    this.#spellHits.push(monster);
    // Monstro não esquiva do jogador — é a mesma regra do `#strike`, e ela vale igual para
    // magia. Quando esquiva de monstro existir, vem do conteúdo e os dois leem do mesmo campo.
    const definition = this.#options.monsters.get(monster.monsterId);
    this.#spellTargets.push({
      armor: definition?.armor ?? 0,
      dodgeChance: 0,
      mitigation: definition?.mitigation,
    });
  }

  /** Usa o supply e leva o gasto ao extrato. O débito em si é do `useSupply`. */
  #useSupply(
    session: Session, character: CharacterRuntime, supplyId: string,
    recipient: CharacterRuntime = character,
  ): CastResult {
    const supply = this.#options.supplies.get(supplyId);
    if (supply === undefined) return NOT_IN_CATALOG;

    // A runa (#165) mira como a magia em área — o mesmo `#aimFor`, o mesmo contrato de ordem —
    // e escala SEMPRE pela skill `magic`: runa é do magic level, em toda vocação.
    const aim = supply.effect.kind === 'damage'
      ? this.#aimFor(character, supply.effect.range, supply.effect.area)
      : null;
    // Quem paga (#192): em solo o usuário; no modo compartilhado, o rateio entre os presentes
    // — e é a bolsa quem credita `goldSpent` a cada um pelo que pagou.
    const shared = this.#party !== undefined && this.#party.shareCosts && session.participants.length > 1;
    const purse = shared ? this.#sharedPurse(session, character) : ownPurse(character);
    const result = useSupply(
      character, supply, aim, this.#options.combat, session.rng, this.#runeScaling(character), purse,
      recipient, session.nowMs,
    );
    if (result.ok) {
      // Gold gasto é agregado da SESSÃO, como `goldGained` é no abate: o extrato leva os dois
      // ao ledger, e o personagem só carrega o delta. No rateio, a bolsa já creditou a cada um.
      if (!shared) session.credit(character.id, 'goldSpent', result.goldSpent);
      // E a CONTAGEM, que é outra pergunta: "gastei 4.000 de gold" e "bebi 80 poções" contam
      // coisas diferentes sobre a mesma hunt, e o §16.1 pede as duas.
      session.credit(character.id, 'suppliesUsed', 1);
      // O uso ANTES do que ele repôs (FUN-109), como a magia sai antes dos golpes dela. Uma
      // poção de mana para aqui: `healed` é zero e a barra de mana não é assunto desta issue.
      session.emit({
        kind: 'supply-used', characterId: character.id, supplyId: supply.id,
        position: this.#at(character),
        targets: aim === null
          ? NO_SPELL_TARGETS
          : this.#spellHits.map((m) => ({ creatureId: m.subject, position: this.#at(m) })),
        tiles: aim === null ? NO_TILES : [...this.#aimTiles],
      });
      if (aim === null) this.#emitHealed(session, recipient, result.healed, 'supply', character.id);
      else this.#applyHits(
        session, character, result.hits,
        supply.effect.kind === 'damage' ? supply.effect.damageType : undefined,
      );
      return result;
    }

    // §20.3 sem a regra de saída: a hunt CONTINUA, sem poção, e o personagem pode morrer. Vale
    // a linha no extrato pela mesma razão que a stamina zerada vale: descobrir isso só pelo
    // personagem morto é como o modo idle perde a confiança de quem o deixou rendendo. Mas só
    // `not-enough-gold` é ESTA notícia (#217): as outras recusas da runa (#165) não são "sem
    // gold". `level-too-low`/`magic-level-too-low` o `BotPanel` já tranca na configuração — a
    // única forma de aparecer aqui é um level-down depois de configurada, e mesmo assim não é
    // pergunta de gold; `no-target`/`out-of-range` são a mira falhando a cada segundo, o mesmo
    // silêncio que `castSpell` já dá às magias.
    if (result.reason === 'not-enough-gold') {
      const runner = this.#runnerOf(character.id);
      if (!runner.warnedNoGold) {
        runner.warnedNoGold = true;
        session.record('supply-unaffordable', supply.id);
      }
    }
    return result;
  }

  /**
   * Reavalia agora o que está engatilhado (FUN-84, AB-07).
   *
   * O mundo mudou de um jeito que pode tornar uma regra válida — o personagem levou dano, um
   * alvo entrou no alcance. Esperar o próximo múltiplo de um relógio para curar quem está
   * caindo é a mesma perda que o golpe engatilhado da FUN-68 corrigiu do outro lado.
   *
   * Só toca grupo ENGATILHADO: quem tem evento pendente já vai vencer, e agendar de novo
   * seria a ação dobrada.
   */
  #armBot(session: Session, characterId: string): void {
    const runner = this.#runnerOf(characterId);
    const bot = runner.bot;
    if (bot === undefined) return;
    for (const group of bot.groups.keys()) {
      if (!runner.botReady[group]) continue;
      this.#scheduleBot(session, group, characterId, 0);
    }
  }

  /** O ÚNICO lugar que agenda grupo. É o que torna "engatilhado ou agendado" verdade. */
  #scheduleBot(
    session: Session, group: string, characterId: string, delayMs: number,
  ): void {
    this.#runnerOf(characterId).botReady[group] = false;
    session.scheduleIn(botEvent(group), delayMs, {
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
  #composeExitRules(config: BotConfigV2 | undefined): readonly HuntExitRule[] {
    if (config === undefined) return this.#injectedExitRules;
    return [...compileExitRules(config.exit, this.#options.items), ...this.#injectedExitRules];
  }

  #botCooldownMs(): number {
    return this.#options.botCooldownMs ?? 1_000;
  }

  /** A política do jogador, ou a de sempre: mais próximo, sem preferência, sem sair da rota. */
  #targetingOf(character: CharacterRuntime): Targeting {
    return targetingOf(this.#runners.get(character.id));
  }

  /**
   * Quanto falta para o livro individual E o de grupo liberarem — o MAIOR dos dois (AB-07/AB-09).
   *
   * A magia tranca TRÊS livros no `castSpell`: o próprio `spell:<id>`, o do grupo e o
   * secundário. O par de `#cooldownOf` só expõe o individual quando não há grupo, então o
   * `spell:<id>` é consultado à parte — sem isso, uma magia de `cooldownMs: 4000` num grupo de
   * `1000` aparecia `ready` no `slotStates` e o `#perform` recusava por 3 s (DT-08). O supply
   * usa o mesmo caminho com o livro do grupo. Zero é "pode executar".
   */
  #cooldownWaitOf(character: CharacterRuntime, action: BotActionV2, nowMs: number): number {
    const { cooldownKey, group } = this.#cooldownOf(action);
    const individualKey = action.kind === 'spell'
      ? spellCooldownKey(action.spellId)
      : supplyCooldownKey(action.supplyId);
    return Math.max(
      character.cooldowns.remainingMs(cooldownKey, nowMs),
      character.cooldowns.remainingMs(groupCooldownKey(group), nowMs),
      character.cooldowns.remainingMs(individualKey, nowMs),
    );
  }

  /**
   * O estado NATURAL de um slot que já passou por `enabled` e cooldown: `ready`, ou `blocked`
   * com o mesmo motivo que `#perform` daria (DT-08). Espelha as fontes — catálogo, mana, saldo
   * e alvo — sem executar e sem consumir sorteio.
   */
  #naturalStateOf(
    set: number, slot: number, character: CharacterRuntime, action: BotActionV2,
  ): SlotState {
    const blocked = (reason: SlotRefusal): SlotState =>
      ({ set, slot, state: 'blocked', remainingMs: 0, reason });

    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      if (spell === undefined) return blocked('not-in-catalog');
      if (character.level < spell.minLevel) return blocked('not-in-catalog');
      if (spell.vocationId !== undefined && character.vocationId !== spell.vocationId) {
        return blocked('not-in-catalog');
      }
      if (character.mana < spell.manaCost) return blocked('not-enough-mana');
      if (this.#needsTarget(spell.effect)) {
        const range = 'range' in spell.effect ? spell.effect.range : undefined;
        if (this.#targetInRange(character, range) === null) return blocked('no-target');
      }
      return { set, slot, state: 'ready', remainingMs: 0 };
    }

    const supply = this.#options.supplies.get(action.supplyId);
    if (supply === undefined) return blocked('not-in-catalog');
    if (supply.effect.kind === 'damage') {
      // A ordem é a de `useSupply`: requisitos, alvo, e SÓ ENTÃO o gold.
      if (supply.requires.level !== undefined && character.level < supply.requires.level) {
        return blocked('not-in-catalog');
      }
      const magic = this.#options.skills.get('magic');
      const magicLevel = magic === undefined ? 0 : character.skills.levelOf(magic);
      if (supply.requires.magicLevel !== undefined && magicLevel < supply.requires.magicLevel) {
        // Motivo PRÓPRIO (RF-02): o `#perform` devolve `magic-level-too-low`, e o espelho do
        // `slotStates` tem de coincidir com ele (DT-08) — genérico aqui é o cliente sem a
        // explicação que o requisito da runa pede.
        return blocked('magic-level-too-low');
      }
      if (this.#targetInRange(character, supply.effect.range) === null) return blocked('no-target');
    }
    // Poção e runa são ABSTRATAS: o "estoque" é o saldo, e sem ele a ação não acontece. O motivo
    // é próprio (`not-enough-gold`) — dizer "não tem o item" de uma poção que não é item é o
    // tooltip errado; `not-enough-item` fica com o consumível físico (carga de bênção, M22).
    if (balanceOf(character) < supply.price) return blocked('not-enough-gold');
    return { set, slot, state: 'ready', remainingMs: 0 };
  }

  /** O efeito exige alvo? Forma que sai do LANÇADOR não exige (onda, cleave, explosão em volta). */
  #needsTarget(effect: { readonly kind: string; readonly area?: SpellArea | undefined }): boolean {
    if (effect.kind !== 'damage' && effect.kind !== 'damage-over-time') return false;
    return effect.area === undefined || !isSelfOrigin(effect.area);
  }

  /**
   * O melhor alvo dentro de `range`, para a mira e o espelho de elegibilidade. Não muta nada.
   *
   * O alvo escolhido vem primeiro (AB-09, ADR 0032 d.5), e vale também para magia e runa. Alvo
   * do JOGADOR fora do alcance devolve `null` — quem mandou mirar num alvo não quer acertar
   * outro; alvo do AUTO-TARGET (#444) cai na política, como em `#attackTarget`.
   */
  #targetInRange(character: CharacterRuntime, range: number | undefined): MonsterRuntime | null {
    const maxDistance = range ?? 1;
    const attack = this.#attackTargetOfRunner(character);
    if (attack !== null) {
      if (distance(character.position, attack.position) <= maxDistance) return attack;
      if (this.#isPinned(character)) return null;
    }
    const candidate = this.#botCandidateOf(character);
    if (candidate !== null
      && distance(character.position, candidate.position) <= maxDistance) {
      return candidate;
    }
    return selectTarget(
      this.#targetingOf(character), this.#monsters, character.position, maxDistance,
    );
  }

  /**
   * A view REAPROVEITADA: campos reescritos, objeto nunca recriado (FUN-80).
   *
   * `range` é o alcance da AVALIAÇÃO (#444): um grupo com runa de alcance 8 precisa contar e
   * mirar a 8, e não no alcance da arma. Ausente é o alcance da arma — o caminho de quem não
   * declarou ação de dano à distância.
   */
  #botViewOf(character: CharacterRuntime, range?: number): BotView {
    const reach = range ?? this.#attackRangeOf(character);
    const target = this.#targetInRange(character, reach);
    this.#botView.self = character;
    this.#botView.targetCount = this.#targetCountFor(character, reach, undefined, null);
    this.#botView.target = target === null
      ? null
      : { health: target.health, maxHealth: this.#maxHealthOf(target) };
    // Sem candidato até que `select` avalie uma regra de alvo != self — e `select` o reescreve a
    // cada regra, então um valor da avaliação anterior nunca vaza para a próxima.
    this.#botView.partyTarget = null;
    return this.#botView;
  }

  /**
   * Quantos alvos VÁLIDOS a condição `targets` enxerga para uma AÇÃO do bot (#216, #444, #480).
   *
   * - **Sem área**: os monstros no `reach` — o alcance do grupo, o da ação de dano à distância
   *   (uma runa de alcance 8 conta a 8), ou o da arma. É o comportamento da #216/#444.
   * - **Com área que sai do lançador** (onda, cleave, feixe, círculo em volta): os monstros nos
   *   tiles da forma projetada a partir do personagem — a área não tem alvo primário, e a
   *   contagem tem de ser a mesma que `#aimFor` vai colher.
   * - **Com área centrada no alvo** (Avalanche, Explosion, cruz): projeta a forma sobre o alvo
   *   primário e conta quem cai nela. Sem alvo primário não há forma, e a contagem é 0 — a
   *   condição não dispara.
   *
   * Ignorado não conta em nenhum dos caminhos (RF-03): a condição não pode ser satisfeita por
   * quem o jogador mandou deixar em paz.
   */
  #targetCountFor(
    character: CharacterRuntime, reach: number, area: SpellArea | undefined,
    actionRange: number | null,
  ): number {
    const targeting = this.#targetingOf(character);
    if (area === undefined) {
      return countTargets(targeting, this.#monsters, character.position, reach);
    }
    if (isSelfOrigin(area)) {
      return countAreaTargets(
        targeting, this.#monsters, areaTiles(area, character.position, character.direction),
      );
    }
    const primary = this.#targetInRange(character, actionRange ?? reach);
    if (primary === null) return 0;
    return countAreaTargets(
      targeting, this.#monsters,
      areaTiles(area, character.position, character.direction, this.#at(primary)),
    );
  }

  /**
   * O maior alcance entre as ações de DANO à distância de um grupo (#444). É o alcance que a
   * condição `targets` e o `target` da view usam, porque é o alcance que a ação do grupo pode
   * de fato atingir — sem ele, uma runa de alcance 8 não enxerga o alvo a 5 tiles.
   *
   * Sem ação de dano, cai no alcance da ARMA: um grupo de cura não herda alcance de runa que
   * ele não tem.
   */
  #groupRange(slots: readonly CompiledSlot[], character: CharacterRuntime): number {
    let maxRange = 0;
    for (const slot of slots) {
      const range = this.#actionRange(slot.act);
      if (range !== null && range > maxRange) maxRange = range;
    }
    return maxRange > 0 ? maxRange : this.#attackRangeOf(character);
  }

  /** O alcance da ação, quando ela mira à distância; `null` para cura e ação sem alvo. */
  #actionRange(action: BotActionV2): number | null {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      if (spell === undefined) return null;
      if (spell.effect.kind !== 'damage' && spell.effect.kind !== 'damage-over-time') return null;
      return 'range' in spell.effect ? spell.effect.range ?? null : null;
    }
    const supply = this.#options.supplies.get(action.supplyId);
    if (supply === undefined || supply.effect.kind !== 'damage') return null;
    return supply.effect.range ?? null;
  }

  /**
   * A forma de área declarada por uma ação de DANO do bot, ou `undefined` (#480). Magia de cura
   * e ação sem área devolvem `undefined`, e o `targets` cai na contagem por alcance.
   */
  #actionArea(action: BotActionV2): SpellArea | undefined {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      return spell?.effect.kind === 'damage' ? spell.effect.area : undefined;
    }
    const supply = this.#options.supplies.get(action.supplyId);
    return supply?.effect.kind === 'damage' ? supply.effect.area : undefined;
  }

  #maxHealthOf(monster: MonsterRuntime): number {
    return this.#options.monsters.get(monster.monsterId)?.health ?? monster.health;
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
  #luring(runner: Runner, character: CharacterRuntime): boolean {
    const lure = runner.bot?.lure;
    if (lure === undefined) return false;

    const perto = countTargets(
      targetingOf(runner), this.#monsters, character.position,
      this.#options.targetSearchRadius ?? 8,
    );
    if (runner.running) {
      if (perto >= lure.max) runner.running = false;
    } else if (perto < lure.min) {
      runner.running = true;
    }
    return runner.running;
  }

  /**
   * Reavalia as automações AGORA (AB-08): dano recebido, vencimento de item, troca de
   * configuração ou entrada na hunt. Cancela o ciclo pendente e o traz para o instante zero —
   * o mesmo desenho de `#armBot`, e a razão é a mesma: esperar o próximo múltiplo de um relógio
   * faria a decisão depender de quando alguém olhou.
   */
  #armAutomations(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined || runner.automations.list.length === 0) return;
    session.cancelEvent(AUTOMATION, characterId);
    session.scheduleIn(AUTOMATION, 0, {
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  /**
   * O ciclo periódico das automações venceu (AB-08, ADR 0032 d.9).
   *
   * Monta a view e o atuador UMA vez e itera o catálogo. As automações são INDEPENDENTES: uma
   * bloqueada (item ausente) informa o motivo e NÃO interrompe as seguintes (RF-09). Quem tem
   * automação habilitada se reagenda para o próximo ciclo; quem não tem não gera evento nenhum.
   */
  #onAutomation(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) return;
    const character = findById(session.participants, characterId);
    if (character !== null && character.alive && runner.actuator !== undefined) {
      const view = this.#botViewOf(character);
      const actuator = runner.actuator;
      for (const automation of runner.automations.list) {
        const outcome = automation.run(view, actuator);
        if (outcome.kind === 'applied') {
          // A automação voltou a agir: o aviso saiu da transição, e a próxima vez que ela
          // bloquear no mesmo motivo volta a valer como notícia.
          runner.automationWarned.delete(automation.model);
          session.record(outcome.event, outcome.detail);
        } else if (outcome.kind === 'blocked') {
          // Só a TRANSIÇÃO registra (#420): uma automação bloqueada por 8 h é UMA linha no
          // extrato, não uma por ciclo. Sem isto, `notableEvents` crescia sem teto e era
          // reserializado inteiro em cada snapshot.
          const key = `${outcome.reason}:${outcome.itemId}`;
          if (runner.automationWarned.get(automation.model) !== key) {
            runner.automationWarned.set(automation.model, key);
            session.record('automation-blocked', `${automation.model}:${key}`);
          }
        } else {
          // `idle`: a automação saiu do bloqueio sem agir (o alvo vivo, o HP voltou). Limpa o
          // aviso para que um novo bloqueio seja notícia de novo.
          runner.automationWarned.delete(automation.model);
        }
      }
    }
    if (runner.automations.list.length > 0) {
      session.scheduleIn(AUTOMATION, AUTOMATION_INTERVAL_MS, {
        priority: EventPriority.Housekeeping, subject: characterId,
      });
    }
  }

  /**
   * O que uma automação pode fazer com o inventário. Fecha sobre o personagem e o catálogo de
   * itens; NENHUM opcode é emitido — a escrita é `character.inventory.equip/unequip` direto,
   * dentro do evento da própria sessão (invariantes 4 e 9).
   *
   * Montado UMA vez por runner (#420), em `#newRunner` e recompilado em `configureBot`. As
   * `containerRules` NÃO são capturadas: elas derivam do inventário (que cresce por level) e
   * seriam um valor velho numa hunt longa, então são lidas na hora em que `unequip` é chamado.
   */
  #automationActuatorFor(runner: Runner, character: CharacterRuntime): AutomationActuator {
    const items = this.#options.items;
    const ammunition = this.#options.ammunition;
    return {
      equippedItemId: (slot) => character.inventory.equippedAt(slot)?.itemId ?? null,
      equippedInstanceId: (slot) => character.inventory.equippedAt(slot)?.instanceId ?? null,
      carriedItem: (itemId) => character.inventory.findStack(itemId),
      slotOf: (itemId) => items.get(itemId)?.slot ?? null,
      equip: (instanceId) => character.inventory.equip(instanceId, character, items).ok,
      unequip: (slot) => character.inventory.unequip(slot, this.#containerRules(character)).ok,
      // A família vem da ARMA na mão; sem arma de distância não há seleção a trocar.
      selectedAmmoId: () => {
        const family = character.inventory.weapon(items, character)?.weapon?.ammoFamily;
        if (family === undefined) return null;
        return character.ammo.get(family) ?? null;
      },
      selectAmmo: (ammoId) => {
        const ammo = ammunition.get(ammoId);
        return ammo === undefined ? false : character.selectAmmo(ammo).ok;
      },
      rememberRing: (instanceId) => { runner.ringReplaced = instanceId; },
      previousRing: () => runner.ringReplaced,
    };
  }

  /**
   * Instala o observer de equipamento e agenda o vencimento do que já está vestido (ADR 0032
   * d.8). A varredura é de no máximo 10 slots UMA vez na entrada — nunca por tick (invariante 2).
   */
  #armEquipment(session: Session, character: CharacterRuntime): void {
    character.inventory.setEquipmentObserver(this.#equipmentObserver(session, character.id));
    for (const slot of ITEM_SLOTS) {
      const equipped = character.inventory.equippedAt(slot);
      if (equipped === null) continue;
      const definition = this.#options.items.get(equipped.itemId);
      if (definition?.durationMs === undefined) continue;
      session.scheduleIn(EQUIP_EXPIRE, definition.durationMs, {
        priority: EventPriority.Housekeeping,
        subject: equipExpirySubject(character.id, slot),
      });
    }
  }

  /** O que agenda e cancela o vencimento por duração. É uma closure pura sobre a `Session`. */
  #equipmentObserver(session: Session, characterId: string): EquipmentObserver {
    return {
      onEquip: (slot, item) => {
        const subject = equipExpirySubject(characterId, slot);
        // Cancela SEMPRE, inclusive quando o novo item não dura: um anel de duração que saiu
        // para outro anel tem de perder o prazo antigo.
        session.cancelEvent(EQUIP_EXPIRE, subject);
        const definition = this.#options.items.get(item.itemId);
        if (definition?.durationMs === undefined) return;
        session.scheduleIn(EQUIP_EXPIRE, definition.durationMs, {
          priority: EventPriority.Housekeeping, subject,
        });
      },
      onUnequip: (slot) => {
        session.cancelEvent(EQUIP_EXPIRE, equipExpirySubject(characterId, slot));
      },
    };
  }

  /**
   * O prazo de um item equipado venceu. Confere que o slot ainda é o item que dura — o
   * cancelamento no desequip cobre o caso comum, e a guarda cobre o resto —, destrói sem passar
   * por container e avisa a apresentação.
   */
  #onEquipExpire(session: Session, subject: string): void {
    const separator = subject.lastIndexOf(':');
    if (separator < 0) return;
    const characterId = subject.slice(0, separator);
    const slot = subject.slice(separator + 1) as ItemSlot;
    const character = findById(session.participants, characterId);
    if (character === null) return;
    const equipped = character.inventory.equippedAt(slot);
    if (equipped === null) return;
    const definition = this.#options.items.get(equipped.itemId);
    if (definition?.durationMs === undefined) return;
    character.inventory.destroy(slot);
    session.record('item-expired', equipped.itemId);
    session.emit({ kind: 'equipment-changed', characterId });
    // O slot esvaziou: a renovação (AB-08) acontece no MESMO despacho, via `#armAutomations`.
    this.#armAutomations(session, characterId);
  }

  /**
   * Gasta uma carga do colar quando o golpe é de um tipo que ELE protege (ADR 0032 d.8). Olha a
   * definição do item vestido, e não a mitigação somada: a soma não diz de quem é a proteção.
   *
   * Gasta mesmo quando o golpe é esquivado (DT-03): a mitigação incide no cálculo antes do corte
   * do Dodge, então ela "trabalhou" no golpe. Resistência negativa é vulnerabilidade e não gasta.
   */
  #consumeAmuletCharge(
    session: Session, character: CharacterRuntime, damageType: DamageType,
  ): void {
    const amulet = character.inventory.equippedAt('neck');
    if (amulet === null) return;
    const definition = this.#options.items.get(amulet.itemId);
    if (definition?.charges === undefined) return;
    const protects = definition.mitigation.immunities.has(damageType)
      || definition.mitigation.resistances[damageType] > 0;
    if (!protects) return;
    if (character.inventory.consumeCharge('neck', definition.charges) > 0) return;
    session.record('amulet-spent', amulet.itemId);
    session.emit({ kind: 'equipment-changed', characterId: character.id });
  }

  #armPlayerAttack(session: Session, character: CharacterRuntime): void {
    if (!this.#runnerOf(character.id).playerAttackReady) return;
    if (!character.alive) return;
    if (this.#attackTarget(character) === null) return;
    this.#schedulePlayerAttack(session, character.id, 0);
  }

  /**
   * O passo de um monstro venceu (CMB-06).
   *
   * A decisão de andar ou bater continua sendo UMA (`decideMonsterAction`), e o alcance de
   * parada é o MAIOR entre as abilities. Depois do passo, as abilities prontas cujo alvo está
   * no alcance DELAS são armadas para agora — é a mesma regra do golpe engatilhado do
   * personagem, do outro lado.
   */
  #onMonsterStep(session: Session, subject: string): void {
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
    // Chegou ao alcance com o golpe engatilhado: ele sai agora, e não no próximo múltiplo de
    // um relógio. É a mesma regra do personagem, do outro lado — e vale por ability.
    this.#armMonsterAbilities(session, monster, definition, target);
    // Um monstro que entrou no raio de busca vira alvo na hora (#444): sem isto, quem se
    // aproxima de fora da tela só seria notado no próximo passo do personagem.
    for (const character of session.participants) {
      this.#autoSelectTarget(session, character);
      this.#armBot(session, character.id);
    }
  }

  /**
   * O ataque BÁSICO de um monstro venceu — o legado, e o caminho do rato (CMB-06).
   *
   * A sequência é a de sempre: reescolhe alvo, confere o alcance, reagenda a cadência e aplica
   * pelo pipeline canônico. Sem alvo ao alcance, ENGATILHA em vez de desperdiçar — quem o traz
   * de volta é o passo, que reavalia a distância a cada vencimento.
   */
  #onMonsterAttack(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const ability = definition.abilities.find((candidate) => candidate.id === BASIC_ABILITY_ID);
    if (ability === undefined) {
      monster.attackReady = true;
      return;
    }

    const prey: readonly Prey[] = session.participants;
    monster.targetId = chooseTarget(monster, prey, definition);
    const target = findById(session.participants, monster.targetId);
    if (target === null || !target.alive
      || distance(monster.position, target.position) > ability.target.range) {
      monster.attackReady = true;
      return;
    }

    this.#scheduleMonsterAttack(session, monster, ability.cadenceMs);
    this.#executeMonsterAbility(session, monster, ability, target);
  }

  /**
   * Uma ability DECLARADA de um monstro venceu (CMB-06). O subject carrega o id dela:
   * `m:<id>:<abilityId>`, e é ele que a morte cancela sem varrer a fila.
   */
  #onMonsterAbility(session: Session, subject: string): void {
    // `m:<id>:<abilityId>`: o id é numérico e vem primeiro, então o `:` seguinte separa a
    // ability — o id dela pode conter `:` sem ambiguidade.
    const rest = subject.startsWith('m:') ? subject.slice(2) : '';
    const separator = rest.indexOf(':');
    if (separator < 0) return;
    const monster = this.#monsterBySubject.get(monsterSubject(Number(rest.slice(0, separator))));
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const abilityId = rest.slice(separator + 1);
    const ability = definition.abilities.find((candidate) => candidate.id === abilityId);
    if (ability === undefined) return;

    monster.scheduledAbilities.delete(ability.id);
    const prey: readonly Prey[] = session.participants;
    monster.targetId = chooseTarget(monster, prey, definition);
    const target = findById(session.participants, monster.targetId);
    if (target === null || !target.alive
      || distance(monster.position, target.position) > ability.target.range) {
      // Alvo saiu do alcance no vencimento: NÃO bate, e a ability volta a ficar engatilhada.
      return;
    }

    this.#scheduleMonsterAbility(session, monster, ability, ability.cadenceMs);
    this.#executeMonsterAbility(session, monster, ability, target);
  }

  /**
   * Arma para AGORA toda ability pronta cujo alvo está no alcance dela.
   *
   * A básica usa `attackReady`; as declaradas usam `scheduledAbilities` — cada uma tem a
   * própria cadência, e um booleano só não distinguiria "vai bater" de "já tem evento na fila".
   */
  #armMonsterAbilities(
    session: Session, monster: MonsterRuntime, definition: Monster, target: Prey | null,
  ): void {
    if (target === null || !target.alive) return;
    for (const ability of definition.abilities) {
      if (distance(monster.position, target.position) > ability.target.range) continue;
      if (ability.id === BASIC_ABILITY_ID) {
        if (monster.attackReady) this.#scheduleMonsterAttack(session, monster, 0);
        continue;
      }
      if (monster.scheduledAbilities.has(ability.id)) continue;
      this.#scheduleMonsterAbility(session, monster, ability, 0);
    }
  }

  /**
   * Aplica uma ability: colhe os alvos ANTES de qualquer dano, emite o lançamento e depois um
   * golpe por alvo.
   *
   * A ORDEM é contrato (FUN-109): o `monster-ability-cast` sai antes dos `creature-hit` dele —
   * o projétil e o impacto do lançamento acompanham os números, não o contrário. E a colheita
   * antes do dano é a regra da FUN-92: resolver morte no meio da varredura mexeria na lista
   * de participantes que está sendo lida.
   */
  #executeMonsterAbility(
    session: Session, monster: MonsterRuntime, ability: MonsterAbility,
    primary: CharacterRuntime,
  ): void {
    const subject = monster.subject;
    const targets = abilityTargets(ability, this.#at(monster), primary, session.participants);
    const melee = isMeleeAbility(ability);
    const source: 'melee' | 'spell' = melee ? 'melee' : 'spell';
    // A apresentação só sai quando há o que desenhar ou quando a ability NÃO é o corpo a corpo
    // legado — é o que mantém o rato bit a bit (nenhum evento a mais por golpe).
    if (!melee || ability.presentation !== undefined) {
      session.emit({
        kind: 'monster-ability-cast', casterId: subject, abilityId: ability.id,
        casterPosition: this.#at(monster),
        targets: targets.map((target) => ({
          creatureId: target.id, position: this.#at(target),
        })),
        tiles: abilityTiles(ability, this.#at(monster), this.#at(primary)),
        ...(ability.presentation?.missileKey === undefined
          ? {} : { missileKey: ability.presentation.missileKey }),
        ...(ability.presentation?.impactKey === undefined
          ? {} : { impactKey: ability.presentation.impactKey }),
      });
    }

    for (const character of targets) {
      const defender = this.#playerDefender(character);
      // A faixa sorteada com o `Rng` da sessão, uma rolagem por alvo — o contrato do loot vale
      // para o dano, e a ordem dos alvos é a de entrada (documentada em `abilityTargets`).
      const result = resolveDamage(
        {
          rawDamage: session.rng.integer(ability.power.min, ability.power.max),
          source: 'monster-attack',
          damageType: ability.damageType,
        },
        defender,
        'pve',
        this.#options.combat,
        session.rng,
      );
      this.#applyMonsterHit(session, subject, character, ability, defender, result, source);
      // A condição da ability (CMB-07), aplicada a CADA alvo vivo que ela acertou. O tique de
      // dano entra no mesmo pipeline do golpe; quem aplicou (o monstro) leva a atribuição.
      if (ability.condition !== undefined && character.alive) {
        this.#applyConditionTo(session, character, conditionFromSpec(
          ability.condition, character.id, subject, session.nowMs, 'monster-attack',
        ));
      }
    }
    // O campo da ability (CMB-07): UMA vez, centrado no alvo principal. A geometria é a mesma
    // da magia (`areaTiles`), e o campo é indexado por tile — nenhum passo varre a lista.
    if (ability.field !== undefined) {
      this.applyField(session, ability.field, this.#at(primary));
    }
  }

  /**
   * O fim de um golpe de ability em UM alvo: aplica, atribui, anuncia, treina shielding e
   * decide a morte. É o mesmo corpo do ataque básico de sempre, agora por alvo.
   */
  #applyMonsterHit(
    session: Session, subject: string, character: CharacterRuntime, ability: MonsterAbility,
    defender: Defender, outcome: DamageOutcome, source: 'melee' | 'spell',
  ): void {
    // O CMB-08: o mana shield do personagem vira estágio explícito, e o hit/atribuição usam o
    // HP APLICADO. A postura (#155) escala o dano TOMADO antes do escudo; o atacante é `null`
    // porque monstro não faz leech — o outcome informa a mana absorvida sem matar ninguém. O
    // Energy Ring (SV-16) é a segunda fonte de escudo, resolvida por quem tem o catálogo.
    const applied = applyDamageOutcome(
      character, outcome, null, character.conditions.damageTakenScale(),
      this.#hasEnergyShield(character),
    );
    recordDamage(character.contribution, subject, applied.healthDamage);
    // O colar gasta UMA carga por golpe do tipo que ele protege (ADR 0032 d.8), mesmo esquivado
    // (DT-03). A proteção vale NESTE golpe; a destruição, se zerou, é para o próximo.
    this.#consumeAmuletCharge(session, character, ability.damageType);
    // O golpe ANTES da barra (FUN-109): o número flutuante acompanha a barra caindo, não o
    // contrário. `attackerId` é o subject do monstro, o mesmo id com que ele nasceu e anda.
    session.emit({
      kind: 'creature-hit', creatureId: character.id, attackerId: subject,
      amount: applied.healthDamage, source, position: this.#at(character),
      damageType: outcome.damageType,
    });
    this.#emitCharacterHealth(session, character);
    // Shielding sobe pelo USO (CMB-04): uma vez por ataque físico ELEGÍVEL recebido — há fonte
    // de defesa e o tipo está aprovado. Nunca por tick, nunca por dano aplicado: um bloqueio
    // total (ou um golpe de 0) ainda é um bloqueio praticado. Ataque elemental não entra.
    if (this.#options.combat.defense !== undefined
      && defender.defense !== undefined && defender.defense.kind !== 'none'
      && this.#options.combat.defense.blockTypes.includes(ability.damageType)) {
      this.#gainSkills(session, character, 'shield-block', 1);
    }
    // HP caiu: reavalia AGORA o que está engatilhado (FUN-84). Esperar o próximo múltiplo de
    // um relógio para curar quem está caindo é a mesma perda que o golpe engatilhado da
    // FUN-68 corrigiu do outro lado — só que aqui ela custa a vida do personagem.
    this.#armBot(session, character.id);
    // E os curandeiros da party: quem tem regra de alvo != self precisa acordar AGORA, sem
    // esperar o próprio ciclo de golpe — o HP que caiu é de OUTRO membro (RF-06).
    this.#armHealersOf(session);
    // E as automações defensivas (§13.8, AB-08): este é o instante em que o anel existe para
    // servir, e é a antecipação que faz o swap acontecer no golpe, não no próximo ciclo.
    this.#armAutomations(session, character.id);
    if (character.health > 0) return;

    // `receiveDamage` já marcou `alive = false`; `kill` é o que conta a morte no extrato e
    // avisa o ruleset. Chamar os dois é deliberado: quem aplica dano não decide morte.
    session.kill(character);
  }

  /** O mesmo do lado do monstro, e pela mesma razão. */
  #scheduleMonsterAbility(
    session: Session, monster: MonsterRuntime, ability: MonsterAbility, delayMs: number,
  ): void {
    monster.scheduledAbilities.add(ability.id);
    session.scheduleIn(MONSTER_ABILITY, delayMs, {
      priority: EventPriority.Attack, subject: monsterAbilitySubject(monster.id, ability.id),
    });
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
      // A direção do personagem (#155): é de onde saem onda, cleave e feixe. Só o passo a
      // escreve, e só a do personagem — o monstro não lança magia.
      if (mover instanceof CharacterRuntime) {
        mover.direction = directionOf(result.from, result.to) ?? mover.direction;
      }
      session.emit({
        kind: 'creature-moved', creatureId,
        from: result.from, to: result.to, durationMs: result.durationMs,
      });
      // A entrada num campo (CMB-07) é observada SÓ depois de um passo ACEITO: `movement`
      // devolve resultado e nunca infringe dano. Um tile recusado não aplica o campo.
      if (mover instanceof CharacterRuntime || mover instanceof MonsterRuntime) {
        this.#enterField(session, mover);
      }
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
    source: CreatureHealed['source'], healerId?: string,
  ): void {
    if (amount <= 0) return;
    // A cura FEITA conta para quem lançou (#431): o evento acende a barra do RECIPIENT, mas o
    // HPS é do healer. O guarda de participante descarta um `sourceId` que não seja personagem
    // (a condição de um monstro, por exemplo) — `creditHealing` somaria num id que não é dono.
    if (healerId !== undefined && session.participants.some((p) => p.id === healerId)) {
      session.creditHealing(healerId, amount);
    }
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
    const monstersAlive = this.#monsters.filter((m) => m.alive).length;
    // As regras são de CADA participante (#203): a view de cada um leva só ele e os agregados
    // dele — `hp-below` e `out-of-gold` leem `participants[0]`. O que disparar faz é da
    // sessão: em solo, encerrar; em party, sair (#193).
    for (const character of session.participants) {
      const runner = this.#runners.get(character.id);
      if (runner === undefined || runner.pendingExit !== null) continue;
      const view: HuntView = {
        elapsedMs: session.aggregates.durationMs,
        aggregates: session.aggregatesOf(character.id),
        participants: [character],
        monstersAlive,
      };
      for (const rule of runner.exitRules) {
        if (!rule.when(view)) continue;
        // O extrato precisa dizer QUAL regra — "sua hunt encerrou por uma regra de saída" sem
        // dizer qual é a mensagem que faz o jogador desconfiar do bot que ele mesmo configurou.
        session.record('exit-rule', rule.id);
        this.#beginExit(session, character.id, 'exit-rule');
        break;
      }
    }
  }

  #beginExit(session: Session, characterId: string, reason: ExitReason): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined || runner.pendingExit !== null) return;
    runner.pendingExit = reason;
    const delayMs = this.#options.hunt.exitDelayMs;
    if (delayMs === undefined) { this.#finishExit(session, characterId); return; }
    session.scheduleIn(EXIT_COUNTDOWN, delayMs, {
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  #onExitCountdown(session: Session, characterId: string): void {
    this.#finishExit(session, characterId);
  }

  #finishExit(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    const reason = runner?.pendingExit ?? null;
    if (runner === undefined || reason === null) return;
    runner.pendingExit = null;
    if (session.participants.length <= 1) {
      if (session.ended === null) session.end(reason);
      return;
    }
    this.#depart(session, characterId, reason);
  }

  // --- combate ------------------------------------------------------------------------------

  /**
   * Um golpe do personagem, do jeito que a arma na mão bate (#152, ADR 0026 decisões 3 e 4;
   * perfis de arma no CMB-05): corpo a corpo com o `attack` da arma (ou desarmado); tiro com o
   * `attack` da munição escolhida, debitando o preço dela; ou wand, gastando mana e causando
   * dano mágico por faixa. Os três compartilham o mesmo fim — aplicar, atribuir, anunciar,
   * contar o recorde, praticar — e é `#land` quem aplica.
   *
   * O poder sai de `resolveWeaponPower` com o PERFIL da arma: o ruleset não conhece nome de
   * item nem vocação (DT-01). A família do perfil aponta a skill e a prática, e é por isso que
   * wand/rod não recebem multiplicador de weapon skill — o perfil deles não tem `power`.
   */
  #strike(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
    weapon: Item | null, how: ResolvedWeapon | undefined,
  ): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const defender: Defender = {
      armor: definition.armor, dodgeChance: 0, mitigation: definition.mitigation,
    };

    if (weapon !== null && how?.kind === 'distance') {
      const ammo = this.#ammoFor(character, how.ammoFamily ?? 'arrow');
      // Sem munição paga pela família — catálogo vazio, ou saldo que não cobre o preço: o tiro
      // NÃO sai. Nada de dano inventado nem de munição grátis (ADR 0026 d.3): sem gold, a regra
      // de saída `out-of-gold` encerra a hunt, como para a poção.
      if (ammo === null) return;
      if (ammo.price > 0) {
        // O rateio do §4 inclui a MUNIÇÃO paga (#394): com `shareCosts` ligado quem paga é a
        // purse compartilhada — a MESMA do supply, com o resto do atirador. O `#ammoFor` já
        // conferiu `canAfford` pela purse; aqui só se debita. Sem rateio, o comportamento de
        // sempre: gold do personagem E agregado da sessão (§20.1).
        const shareCosts = this.#party !== undefined && this.#party.shareCosts && session.participants.length > 1;
        if (shareCosts) {
          this.#sharedPurse(session, character).pay(ammo.price);
        } else {
          character.goldDelta -= ammo.price;
          session.credit(character.id, 'goldSpent', ammo.price);
        }
      }
      session.emit({
        kind: 'shot', attackerId: character.id, targetId: monster.subject,
        weaponItemId: weapon.id, ammoId: ammo.id, from: this.#at(character), to: this.#at(monster),
      });
      // O `base` da fórmula e o TIPO são da MUNIÇÃO (o bow não tem attack próprio), e a família
      // e a escala vêm do perfil da arma. Uma alocação por tiro, como o `defender` acima.
      const power = how.power;
      const profile: WeaponProfile = {
        family: how.family,
        damageType: ammo.damageType,
        range: how.range,
        ...(power === undefined ? {} : { power: { ...power, base: ammo.attack } }),
      };
      const result = resolveDamage(
        {
          rawDamage: this.#weaponPower(session, character, profile),
          source: 'basic-attack',
          damageType: profile.damageType,
          modifiers: this.#options.combat.modifiers,
        },
        defender, 'pve', this.#options.combat, session.rng,
      );
      this.#land(session, character, monster, result, 'melee');
      this.#practice(session, character, profile.family, 1);
      // A munição é ABSTRATA: nada de pilha a consumir. O tiro que saiu já pagou o preço, e o
      // próximo usa a mesma seleção (ou a básica da família) enquanto houver gold.
      return;
    }

    if (weapon !== null && how?.kind === 'wand') {
      const manaPerHit = how.manaPerHit ?? 0;
      // A mana sai ANTES da rolagem, e a conferência foi em `#onPlayerAttack`: chegar aqui é
      // ter mana. Uma rolagem por golpe, com o `Rng` da sessão — a mesma semente, o mesmo
      // dano, como o loot (contrato).
      character.mana -= manaPerHit;
      session.emit({
        kind: 'shot', attackerId: character.id, targetId: monster.subject,
        weaponItemId: weapon.id, from: this.#at(character), to: this.#at(monster),
      });
      // Dano por faixa fixa e do TIPO da arma (CMB-03): a wand de vortex é energia, o rod de
      // snakebite é terra; sem declaração o boot resolve `arcane`, o `kind: magic` do v1. O
      // perfil da wand/rod não tem `power`, então NÃO há multiplicador de weapon skill (DT-02).
      const result = resolveDamage(
        {
          rawDamage: this.#weaponPower(session, character, how),
          source: 'basic-attack',
          damageType: how.damageType,
          modifiers: this.#options.combat.modifiers,
        },
        defender, 'pve', this.#options.combat, session.rng,
      );
      this.#land(session, character, monster, result, 'spell');
      // Rende magia pela MANA gasta, como a magia (§9.4): é assim que a wand treina magic level.
      this.#practice(session, character, how.family, manaPerHit);
      return;
    }

    // Corpo a corpo — ou desarmado: sem arma na mão vale o perfil `fist` (CMB-05), que carrega
    // o `attack`, o alcance e o tipo de `combat.player`.
    const profile: WeaponProfile = how ?? this.#options.unarmed;
    const result = resolveDamage(
      {
        rawDamage: this.#weaponPower(session, character, profile),
        source: 'basic-attack',
        damageType: profile.damageType,
        modifiers: this.#options.combat.modifiers,
      },
      defender, 'pve', this.#options.combat, session.rng,
    );
    this.#land(session, character, monster, result, 'melee');
    // O golpe ACONTECEU: conta como uso, tenha ele acertado forte ou de raspão, e mesmo que o
    // alvo seja imune ou já esteja morto — praticar não depende do dano final (CMB-05).
    this.#practice(session, character, profile.family, 1);
  }

  /**
   * O poder bruto de um golpe pelo PERFIL (CMB-05), com a postura por último.
   *
   * A skill que escala é a da FAMÍLIA, não uma por nome: o ruleset lê `family.skillId` do
   * conteúdo e o nível do personagem. Corpo a corpo e distância recebem a postura (`buff`);
   * wand/rod têm faixa fixa e não passam por ela — como sempre.
   */
  #weaponPower(session: Session, character: CharacterRuntime, profile: WeaponProfile): number {
    const family = this.#options.weaponFamilies.get(profile.family);
    const skill = family === undefined ? undefined : this.#options.skills.get(family.skillId);
    const skillLevel = skill === undefined ? 0 : character.skills.levelOf(skill);
    const power = resolveWeaponPower(profile, character.level, skillLevel, session.rng);
    if (family?.kind === 'distance') {
      return Math.round(power * character.conditions.damageDealtScale('distance'));
    }
    if (family?.kind === 'melee') {
      return Math.round(power * character.conditions.damageDealtScale('melee'));
    }
    return power;
  }

  /**
   * Pratica UMA vez pelo golpe, pela skill que a família aponta (CMB-05). A prática é o
   * `gain` da skill — `melee-hit`/`distance-hit` rendem por uso, `spell-cast` por mana gasta —
   * e o gatilho vem do conteúdo, nunca de um `if` por nome.
   *
   * É chamada DEPOIS do `#land` e sem condição de dano: imunidade, resistência alta ou alvo
   * morto no impacto não impedem a prática, porque o golpe de fato ocorreu.
   */
  #practice(
    session: Session, character: CharacterRuntime, family: WeaponFamily, amount: number,
  ): void {
    const definition = this.#options.weaponFamilies.get(family);
    if (definition === undefined) return;
    const skill = this.#options.skills.get(definition.skillId);
    if (skill === undefined) return;
    this.#gainSkills(session, character, skill.gain.on, amount);
  }

  /** O fim de todo golpe do personagem: aplicar, atribuir, anunciar e contar o recorde. */
  #land(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
    outcome: DamageOutcome, source: 'melee' | 'spell',
  ): void {
    // O CMB-08: aplicar é o estágio explícito que passa pelo mana shield (no alvo), remove HP
    // efetivo e credita o leech clampado no atacante. O `outcome` já traz o resolvido e o
    // crítico; a atribuição e o hit usam o HP APLICADO, nunca a mana absorvida nem o overkill.
    const applied = applyDamageOutcome(monster, outcome, character);
    recordDamage(monster.contribution, character.id, applied.healthDamage);
    // O número que flutua é o APLICADO — o que saiu da barra —, e sai ANTES dela (FUN-109). O
    // resolvido é o recorde do extrato, logo abaixo; mostrar 300 sobre um rato de 10 é o
    // cliente contando uma história que a barra desmente.
    session.emit({
      kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
      amount: applied.healthDamage, source, position: this.#at(monster),
      damageType: outcome.damageType,
    });
    this.#emitHealth(session, monster);
    // Life leech (CMB-08): o que de fato repôs no atacante, já clampado no teto. Atacante cheio,
    // ou alvo integralmente absorvido pela mana, informa zero e não emite evento — o número
    // verde não mente.
    this.#emitHealed(session, character, applied.lifeLeechApplied, 'leech', character.id);
    // O maior hit é o RESOLVIDO, não o aplicado (§16.1): um golpe de 300 num monstro com 10 de
    // vida foi um golpe de 300. Guardar o aplicado faria o recorde depender de quão morto o
    // alvo já estava, e o jogador nunca veria o número que ele de fato bateu.
    session.credit(character.id, 'bestBasicHit', outcome.resolvedDamage);
    // O DPS, ao contrário do recorde, soma o APLICADO (#431): overkill e absorção por mana
    // shield não são dano que saiu da barra de ninguém.
    session.creditDamage(character.id, applied.healthDamage);
  }

  /**
   * A munição que o tiro usa (#152, ADR 0026 d.3): a escolhida da família, ou a BÁSICA dela.
   *
   * `null` é "não atira": a família não tem munição no catálogo, ou o saldo não cobre o preço.
   * **Não existe munição grátis** — sem gold o tiro não sai, e é a regra de saída `out-of-gold`
   * que encerra a hunt. O preço é conferido ANTES do gold sair, e o débito fica em `#strike`.
   */
  #ammoFor(character: CharacterRuntime, family: AmmoFamily): Ammunition | null {
    const chosenId = character.ammo.get(family);
    const chosen = chosenId === undefined ? undefined : this.#options.ammunition.get(chosenId);
    const ammo = chosen !== undefined && chosen.family === family
      ? chosen
      : this.#basicAmmo.get(family) ?? null;
    if (ammo === null || balanceOf(character) < ammo.price) return null;
    return ammo;
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
    // Nenhuma skill alimentada por esta fonte: só a postura, se houver. É o caminho de um
    // conteúdo sem skills, e ele custa uma comparação — e uma multiplicação com postura.
    if (definitions.length === 0) {
      if (on === 'melee-hit') return Math.round(base * character.conditions.damageDealtScale('melee'));
      if (on === 'distance-hit') return Math.round(base * character.conditions.damageDealtScale('distance'));
      return base;
    }

    let power = base;
    for (let i = 0; i < definitions.length; i += 1) {
      const definition = definitions[i] as Skill;
      if (definition.damagePerLevel === 0) continue;
      power *= powerMultiplier(definition, character.skills.levelOf(definition));
    }
    // A postura (#155) escala o golpe e o tiro aqui; a magia é escalada dentro de `castSpell`,
    // por alvo — aplicar nos dois lugares contaria a mesma postura duas vezes.
    if (on === 'melee-hit') power *= character.conditions.damageDealtScale('melee');
    else if (on === 'distance-hit') power *= character.conditions.damageDealtScale('distance');
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
      const points = gain.on === 'spell-cast' ? gain.pointsPerMana * amount : gain.points * amount;
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
    const definition = this.#options.monsters.get(monster.monsterId);
    const killer = findById(session.participants, credit.lastHitBy);
    // O abate conta SEMPRE, para todo presente: "matei N" é a pergunta do analisador de cada
    // um (#190, DT-01), e a party matou junto. Em solo é o de sempre — conta mesmo com a fonte
    // sumida ou o dono morto; o extrato mentiria se dissesse que não.
    for (const participant of session.participants) session.credit(participant.id, 'kills', 1);

    const eligible = session.participants.length === 1
      ? (killer !== null && killer.alive && !isExhausted(killer) ? [killer] : NO_MEMBERS)
      : session.participants.filter((p) => p.alive && !isExhausted(p));
    // Quem recebe o loot (#191): em solo, o matador — se pode receber; sem dono (fonte que
    // sumiu) ou dono morto, ninguém. Em party `split`, UM elegível sorteado; em `shared`,
    // ninguém — a bolsa (#192).
    const recipient = this.#lootRecipient(session, killer, eligible);
    if (definition !== undefined && this.#bag !== null && session.participants.length > 1) {
      // Modo compartilhado (#192): tudo cai na BOLSA — sem destinatário, sem modificador
      // individual, e a ordem do RNG é a de solo (gold, depois itens na ordem da tabela).
      // Só com alguém elegível: um monstro que morreu com todo mundo morto não paga ninguém.
      if (eligible.length > 0) {
        const loot = rollLoot(definition.loot, session.rng);
        // Elegibilidade da bolsa (D4/§16.1): TODOS os presentes no instante do abate — o mesmo
        // conjunto que paga o rateio, não o `eligible` (vivo + stamina) que decide XP.
        const presentAtDrop = session.participants.map((p) => p.id);
        if (loot.gold > 0) this.#bag.gold.push({ amount: loot.gold, eligible: presentAtDrop });
        // `#deliverToBag` rebalanceia e emite SEMPRE (mesmo sem itens: o gold muda o `value`),
        // então o `#emitBag` que existia aqui para o drop de gold puro sumiu (DT-03).
        this.#deliverToBag(session, loot.items);
      }
    } else if (definition !== undefined && recipient !== null) {
      // Gold vira DELTA no personagem e agregado na sessão. O extrato leva os dois ao ledger
      // (invariante 10) — nada aqui escreve banco, e nada aqui inventa saldo final.
      const loot = rollLoot(this.#lootTableFor(definition, recipient), session.rng);
      recipient.goldDelta += loot.gold;
      session.credit(recipient.id, 'goldGained', loot.gold);
      // O item cai DEPOIS do gold, na ordem da tabela — a ordem dos sorteios é contrato
      // (FUN-63), e acrescentar destino não muda sorteio nenhum.
      this.#deliverLoot(session, recipient, loot.items);
    }
    // A XP é da PARTY (#190, ADR 0027 decisão 3): pool por vocações únicas, dividido por igual
    // entre os elegíveis — e em solo o elegível é o matador, pela mesma condição de sempre.
    if (definition !== undefined) this.#grantPartyXp(session, monster, definition, eligible);
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
    // O cadáver, só visual (FUN-123): fica no tile por `corpseTtlMs` e some sozinho, sem
    // loot — o loot já foi para a caixa da sessão acima. O `sim` diz que monstro morreu e onde;
    // a arte é da tabela, no hospedeiro (invariante 6). Hunt sem `corpseTtlMs` não deixa nada.
    const corpseTtlMs = this.#options.hunt.corpseTtlMs;
    if (corpseTtlMs !== undefined) {
      const corpse: CorpseState = {
        id: this.#nextGroundItemId++,
        monsterId: monster.monsterId,
        position: { x: monster.position.x, y: monster.position.y, z: this.floor },
      };
      this.#corpses.push(corpse);
      session.emit({
        kind: 'ground-item-appeared', itemId: corpse.id, monsterId: corpse.monsterId,
        position: corpse.position,
      });
      session.scheduleIn(CORPSE, corpseTtlMs, {
        priority: EventPriority.Housekeeping, subject: String(corpse.id),
      });
    }
    // Os eventos dele já saíram da fila: congelar é o primeiro estágio do pipeline. Aqui só
    // se tira o monstro dos índices desta instância — e da atribuição de quem ele bateu, senão
    // o mapa do personagem cresce uma chave por respawn até o fim da hunt.
    const subject = monster.subject;
    // As CONDIÇÕES do monstro (CMB-07) saem com ele: sem isto, o DOT de um monstro morto
    // continuaria na fila e venceria contra o vazio. O `resolveDeath` só cancela o `m:<id>`.
    this.#cancelConditions(session, monster);
    for (const character of session.participants) forgetActor(character.contribution, subject);
    // As abilities DECLARADAS têm subject DERIVADO (CMB-06), e o `resolveDeath` só cancelou o
    // `m:<id>`. Cancelar pelos ids que o conteúdo conhece é O(abilities), sem varrer a fila —
    // e é o que impede um monstro morto de acordar uma vez por cadência.
    for (const ability of definition?.abilities ?? []) {
      if (ability.id === BASIC_ABILITY_ID) continue;
      session.cancelEvent(MONSTER_ABILITY, monsterAbilitySubject(monster.id, ability.id));
    }
    this.#monsterBySubject.delete(subject);
    this.#monsters = this.#monsters.filter((m) => m.id !== monster.id);
    // O alvo escolhido morreu: o auto-target reavalia AGORA para o próximo mais próximo na tela
    // (#444, AB-09). O alvo antigo aponta para um subject que acabou de sair do índice, e são
    // `#attackTargetOfRunner`/`#botCandidateOf` que o limpam — não há um segundo lugar para
    // esquecer de limpar.
    for (const character of session.participants) this.#autoSelectTarget(session, character);
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
  /**
   * A XP de um abate, dividida pela party (#190, ADR 0027 decisão 3).
   *
   * `pool = floor(xp × tabela[vocações únicas] / 100)`, `cota = floor(pool / elegíveis)`, resto
   * descartado. Elegível é quem está VIVO com stamina — a condição que sempre decidiu se o
   * matador recebia, aplicada a cada membro. Em solo, `xpShare` devolve a XP inteira sem ler
   * a tabela, e o único elegível é o matador: nada muda, inclusive quando a fonte do golpe
   * sumiu — aí o solo continua sem XP, porque o único candidato não é o matador (DT-04).
   *
   * A ordem é contrato: para cada elegível, na ordem de ENTRADA, `applyXpBonus` (o bônus de
   * Bestiário de ANTES deste abate — DT-04 da FUN-113) → `grantXp` → `record` no Bestiário.
   * Nada aqui consome RNG.
   */
  #grantPartyXp(
    session: Session, monster: MonsterRuntime, definition: Monster, eligible: readonly CharacterRuntime[],
  ): void {
    if (eligible.length === 0) return;
    const share = xpShare(definition.experience, eligible, this.#options.party);
    const solo = session.participants.length === 1;
    for (const member of eligible) {
      const experience = member.bestiary.applyXpBonus(share, this.#options.bestiary);
      const change = grantXp(member, experience, this.#vocationOf(member), this.#options.progression);
      session.credit(member.id, 'xpGained', experience);
      // Level up É evento notável, ao contrário do abate: é a única coisa que aconteceu numa
      // hunt de oito horas que o jogador quer ver ao voltar (§16.2). Em party o detalhe diz
      // DE QUEM (DT-02); em solo fica como sempre foi, e `event-text.ts` lê o formato solo.
      if (change !== null) {
        session.record('level-up', solo ? String(change.to) : `${member.id}/${String(change.to)}`);
        // E reescreve `health`/`maxHealth` pela tabela (`retarget`): a barra sai daqui como
        // de todo lugar que a escreve (FUN-109). Sem isto, a barra sobre o herói ficava com o
        // máximo velho até o próximo golpe ou regeneração — e de vida cheia a regeneração não
        // anuncia nada, então "até a reanexação".
        this.#emitCharacterHealth(session, member);
        // Level up REESCREVE `capacity` pela tabela (`retarget`, progression.ts): é gatilho do
        // §13 — a disponível do membro cresce, e as reservas mudam com ela.
        this.#rebalanceBag(session);
      }
      // O abate conta no Bestiário de TODO elegível (ADR 0027 decisão 4), pela MESMA condição
      // que paga a XP (§18.6): stamina zero não conta abate. E fechar um marco é evento
      // notável, como o level up: acontece cinco vezes por monstro na vida do personagem.
      const reached = member.bestiary.record(monster.monsterId, this.#options.bestiary);
      if (reached.milestoneReached !== null) {
        const detail = `${monster.monsterId}/${String(reached.milestoneReached)}`;
        session.record('bestiary-milestone', solo ? detail : `${member.id}/${detail}`);
      }
    }
  }

  /**
   * O rateio de um supply no modo compartilhado (#192, ADR 0027 decisão 5).
   *
   * `floor(c / n)` de cada presente e o resto do usuário; quem não tem saldo para a cota paga
   * o que tem e o usuário cobre; se nem o usuário cobre, `canAfford` é `false` e nada é
   * debitado de ninguém — a garantia continua sendo a ORDEM, como no solo. `pay` credita
   * `goldSpent` a cada um pelo que pagou: o extrato de cada membro sai equalizado.
   */
  #sharedPurse(session: Session, user: CharacterRuntime): Purse {
    const plan = (cost: number): Map<string, number> | null => {
      const present = session.participants;
      const share = Math.floor(cost / present.length);
      const paid = new Map<string, number>();
      let uncovered = cost - share * present.length;   // o resto é do usuário
      for (const member of present) {
        if (member === user) continue;
        const can = Math.min(share, Math.max(0, balanceOf(member)));
        paid.set(member.id, can);
        uncovered += share - can;
      }
      const mine = share + uncovered;
      if (balanceOf(user) < mine) return null;
      paid.set(user.id, mine);
      return paid;
    };
    return {
      canAfford: (cost) => plan(cost) !== null,
      pay: (cost) => {
        const paid = plan(cost);
        if (paid === null) return;
        for (const member of session.participants) {
          const gold = paid.get(member.id) ?? 0;
          if (gold === 0) continue;
          member.goldDelta -= gold;
          session.credit(member.id, 'goldSpent', gold);
        }
      },
    };
  }

  /** O líder presente, ou o mais antigo (#192): é dele a caixa do excedente e o invendável. */
  #leader(session: Session): CharacterRuntime | undefined {
    const wanted = this.#party?.leaderId;
    return session.participants.find((p) => p.id === wanted) ?? session.participants[0];
  }

  /**
   * O limite de tipos vendáveis do LÍDER (D2/§23.1): o Premium é do PERSONAGEM líder, nunca do
   * usuário do item. O conteúdo manda os números; a sessão só lê.
   */
  #autoSellLimit(): number {
    const party = this.#party;
    if (party === undefined) return 0;
    return autoSellLimit(
      party.premiumByCharacter, party.leaderId, this.#options.party.autoSellItemTypes,
    );
  }

  /** Os ids que de fato vendem: só os `autoSellLimit` PRIMEIROS da lista configurada (§23.1). */
  #effectiveAutoSell(): ReadonlySet<string> {
    const party = this.#party;
    if (party === undefined) return EMPTY_AUTO_SELL;
    return new Set(party.autoSell.slice(0, this.#autoSellLimit()));
  }

  /**
   * O loot cai na bolsa (#192, #396): pelo PESO, contra a capacidade DISPONÍVEL somada
   * (`capacity − inventory.weight`), não a total — bolsa e mochila contavam a mesma capacidade
   * duas vezes. `itemsLooted` conta para todo presente — "quantos itens caíram" é a pergunta do
   * §16.1, e caíram para a party (DT-03) —, mas SÓ o que de fato é coletado.
   *
   * A lista de COLETA filtra DEPOIS de `rollLoot` (§7, D2): zero RNG a mais (FUN-63), e o item
   * fora da lista fica no cadáver — sem `itemsLooted`, sem caixa de ninguém. A VENDA AUTOMÁTICA
   * é um subconjunto lógico da coleta: o item vendável nunca pesa nem entra na bolsa, vira gold
   * na hora dividido pelos presentes no abate (§8, D2/§16.1).
   *
   * Em OVERWEIGHT (§14, DT-01) um item com `weight > 0` que não cabe NÃO é coletado: fica no
   * cadáver — nem bolsa, nem caixa do líder (a caixa é coletar com outro destinatário). Item de
   * peso `0` sempre entra, gold sempre entra, autovenda sempre vende.
   */
  #deliverToBag(session: Session, items: readonly LootItem[]): void {
    const bag = this.#bag;
    const party = this.#party;
    if (bag === null || party === undefined) return;
    // A capacidade DISPONÍVEL é lida uma vez por abate: itens de um mesmo drop só aumentam
    // `#bagWeight`, então o teto não muda no meio do laço.
    const totalAvailable = this.#availableCapacities(session)
      .reduce((sum, m) => sum + m.available, 0);
    // Elegibilidade da bolsa (D4/§16.1): TODOS os presentes no instante do abate — o mesmo
    // conjunto que paga o rateio, não o `eligible` (vivo + stamina) que decide XP.
    const presentAtDrop = session.participants.map((p) => p.id);
    const effectiveAutoSell = this.#effectiveAutoSell();

    for (const rolled of items) {
      const definition = this.#options.items.get(rolled.itemId);
      if (definition === undefined) continue;

      // Filtro de coleta (§7, D2), DEPOIS de `rollLoot` — zero RNG a mais (FUN-63). Fora da
      // lista, o item não existe para a party: sem `itemsLooted`, sem caixa de ninguém.
      if (party.collect !== null && !party.collect.includes(rolled.itemId)) {
        continue;
      }

      // Venda automática (§8, D2): subconjunto lógico da coleta — nunca pesa, nunca entra na
      // bolsa. `value: 0` na lista é ignorado aqui como defesa (configureParty já recusa
      // configurar assim; isto cobre conteúdo que mudou de valor sob uma sessão em voo).
      if (effectiveAutoSell.has(rolled.itemId) && definition.value > 0) {
        const amount = definition.value * rolled.quantity;
        const split = splitEqually(amount, presentAtDrop.length);
        const shares = presentAtDrop.map((characterId, i) => ({ characterId, gold: split[i] ?? 0 }));
        for (const { characterId, gold } of shares) {
          if (gold === 0) continue;
          const member = findById(session.participants, characterId);
          if (member === null) continue;
          member.goldDelta += gold;
          session.credit(member.id, 'goldGained', gold);
        }
        for (const p of session.participants) session.credit(p.id, 'itemsLooted', rolled.quantity);
        // Venda automática NÃO é evento notável (D2): a lista curta da tela de retorno não leva
        // uma linha por dragon ham — só `party-settlement` de saída/fim/toggle entra ali.
        session.emit({
          kind: 'party-settlement', total: amount, reason: 'auto-sell', itemId: rolled.itemId, shares,
        });
        continue;
      }

      const weight = definition.weight * rolled.quantity;
      // OVERWEIGHT (§14): item com peso que não cabe não é coletado — fica no cadáver, sem
      // virar instância, sem contar `itemsLooted`, sem caixa de ninguém. Peso `0` sempre passa.
      if (weight > 0 && this.#bagWeight + weight > totalAvailable) continue;

      const carried: CarriedItem = {
        instanceId: `${session.id}:bag:${String(this.#bagSeq++)}`,
        itemId: rolled.itemId, quantity: rolled.quantity,
      };
      bag.items.push({ item: carried, eligible: presentAtDrop });
      this.#bagWeight += weight;
      for (const p of session.participants) session.credit(p.id, 'itemsLooted', carried.quantity);
    }
    // `#rebalanceBag` é o ÚNICO emissor de `party-bag-changed` (DT-03) e roda mesmo com `items`
    // vazio, porque um drop só de gold muda o `value` da bolsa.
    this.#rebalanceBag(session);
  }

  /** A capacidade DISPONÍVEL de cada presente: `max(0, capacity − inventory.weight)` (§12, D4). */
  #availableCapacities(session: Session): MemberCapacity[] {
    return session.participants.map((p) => ({
      id: p.id,
      available: Math.max(0, p.capacity - p.inventory.weight(this.#options.items)),
    }));
  }

  /**
   * O ÚNICO ponto que recalcula disponível/reservas/OVERWEIGHT e emite `party-bag-changed`
   * (§11-§15, #396). Chamado só nos gatilhos do §13: `onEnter`, `onLeave` (via `#settle`),
   * `#deliverToBag`, `#deliverLoot`, level up que reescreve `capacity`, `#settle`, autovenda
   * (dentro de `#deliverToBag`) e `configureParty`. NUNCA por tick — é o que faz 1 Hz e 10 Hz
   * rebalancearem no mesmo evento lógico, não no mesmo instante de relógio (invariante 2).
   */
  #rebalanceBag(session: Session): void {
    const bag = this.#bag;
    if (bag === null) return;
    const members = this.#availableCapacities(session);
    const totalAvailable = members.reduce((sum, m) => sum + m.available, 0);
    const reservedById = reserveProportionally(this.#bagWeight, members);
    const reservations = members.map((m) => ({
      characterId: m.id, reserved: reservedById.get(m.id) ?? 0, available: m.available,
    }));
    // OVERWEIGHT: a bolsa está CHEIA — não há mais espaço para item com peso. O ADR escreve
    // `W > ΣB`, mas como só se adiciona o que cabe, `W` nunca ultrapassa `ΣB` por drop; a
    // igualdade é o estado de "cheio" do plano §3 (bolsa 1 500 com disponível 1 500), e é o que
    // o gatilho de recusa enxerga. Bolsa vazia (peso 0) NUNCA é OVERWEIGHT, mesmo com ΣB = 0.
    const overweight = this.#bagWeight > 0 && this.#bagWeight >= totalAvailable;
    // Uma linha por TRANSIÇÃO: comparar com o valor JÁ PERSISTIDO em `bag.overweight` é o que
    // evita um `party-overweight` falso logo depois de um `onResume` (DT-02/§7).
    if (overweight !== bag.overweight) {
      session.record('party-overweight', overweight ? 'on' : 'off');
    }
    bag.overweight = overweight;
    bag.capacity = totalAvailable;
    this.#emitBag(session, reservations);
  }

  #emitBag(session: Session, reservations: PartyBagChanged['reservations'] = []): void {
    const bag = this.#bag;
    if (bag === null) return;
    session.emit({
      kind: 'party-bag-changed',
      gold: bag.gold.reduce((sum, entry) => sum + entry.amount, 0),
      items: bag.items.map((entry) => entry.item),
      weight: this.#bagWeight, capacity: bag.capacity,
      value: bagValue(bag, this.#options.items),
      overweight: bag.overweight,
      reservations,
    });
  }

  /**
   * Vende a bolsa ENTRADA por entrada (#192, ADR 0027 decisão 5; #395, D4/D6): ao sair alguém
   * — com quem sai incluído —, no fim, e ao desligar `splitLoot`. Cada entrada é dividida só
   * entre `eligible ∩ present`; cada um recebe a cota em `goldDelta` e `goldGained`; o resto vai
   * um gold por membro na ordem de entrada. O que não se vende (`value: 0`) vai para a mochila
   * do líder, e o que não couber para a caixa dele. Registrado no extrato — "vendeu nada" também
   * é informação.
   */
  #settle(
    session: Session, present: readonly CharacterRuntime[], reason: 'leave' | 'end' | 'toggle',
  ): void {
    const bag = this.#bag;
    if (bag === null || present.length === 0) return;
    if (bag.gold.length === 0 && bag.items.length === 0) {
      // Nada a vender, mas a composição pode ter mudado (saída): rebalanceia mesmo assim.
      this.#rebalanceBag(session);
      return;
    }
    const { shares, unsold, total } = settleEntries(bag, present.map((p) => p.id), this.#options.items);
    for (const member of present) {
      const gold = shares.get(member.id) ?? 0;
      if (gold === 0) continue;
      member.goldDelta += gold;
      session.credit(member.id, 'goldGained', gold);
    }
    // A bolsa foi VENDIDA: a reserva que ela impunha à mochila cai junto, ANTES de devolver o
    // que não vendeu. Senão a própria reserva recusaria o item que a bolsa guardava — o líder
    // recebe os `unsold` com a capacidade cheia (RF-05: "settlement libera a reserva").
    bag.gold = [];
    bag.items.length = 0;
    this.#bagWeight = 0;
    const leader = this.#leader(session) ?? present[0];
    if (leader !== undefined) {
      const wearer = withReservedCapacity(leader, 0);
      for (const item of unsold) {
        if (leader.inventory.add(item, this.#options.items, wearer, this.#containerRules(leader)).ok) continue;
        leader.lootBox.push(item);
      }
    }
    session.record('party-settlement', `${String(total)}/${String(present.length)}`);
    session.emit({
      kind: 'party-settlement', total, reason,
      shares: present.map((p) => ({ characterId: p.id, gold: shares.get(p.id) ?? 0 })),
    });
    this.#rebalanceBag(session);
  }

  /**
   * Quem recebe o loot de um abate (#191, ADR 0027 decisão 5).
   *
   * Solo — ou party que virou solo —: o matador, e NENHUM sorteio. Um `rng` a mais aqui
   * mudaria a sequência de loot de toda hunt existente (FUN-63), e o teste que grava a
   * sequência é o que prende. Party `split` com ≥ 2: um elegível sorteado, uniforme, ANTES de
   * `rollLoot` — os modificadores (Prey, quando existir) são do destinatário e mudam a tabela
   * rolada. Party `shared`: ninguém; o loot vai para a bolsa (#192).
   */
  #lootRecipient(
    session: Session, killer: CharacterRuntime | null, eligible: readonly CharacterRuntime[],
  ): CharacterRuntime | null {
    if (this.#party === undefined || session.participants.length < 2) {
      return killer !== null && killer.alive && !isExhausted(killer) ? killer : null;
    }
    if (this.#party.splitLoot) return null;
    if (eligible.length === 0) return null;
    return eligible[session.rng.integer(0, eligible.length - 1)] ?? null;
  }

  /**
   * A tabela de loot COMO o destinatário a vê. Identidade hoje: não há modificador de loot
   * por personagem — o Prey (§19) é quem vai mexer aqui, e o gancho existe para ele entrar
   * DEPOIS do sorteio do destinatário, e não antes.
   */
  #lootTableFor(definition: Monster, _recipient: CharacterRuntime): Monster['loot'] {
    return definition.loot;
  }

  #deliverLoot(
    session: Session, character: CharacterRuntime, items: readonly LootItem[],
  ): void {
    // O loot PESSOAL entra na mochila com a capacidade já descontada da reserva que a party fez
    // dele (§11, DT-05). Hoje `#deliverLoot` só roda quando `#bag` é `null` (o modo compartilhado
    // entrega pela bolsa), então `reserved` é 0; o `Wearer` derivado fica pela consistência e
    // blinda o código se uma issue futura mudar quando este caminho roda com bolsa ativa.
    const reserved = this.#bag === null
      ? 0
      : (reserveProportionally(this.#bagWeight, this.#availableCapacities(session)).get(character.id) ?? 0);
    const wearer = withReservedCapacity(character, reserved);
    for (const rolled of items) {
      // O catálogo é conferido ANTES de gastar um id. `buildContent` recusa loot de item
      // inexistente no boot, então isto só acontece com o conteúdo mudando sob uma sessão em
      // voo — e aí o certo é não entregar nada e não queimar identidade por um item que não
      // vai existir.
      if (this.#options.items.get(rolled.itemId) === undefined) continue;

      // O id é determinístico (`sessionId:n`, FUN-88) e vira chave primária de `item_instance`.
      // `lootSeq` é do PERSONAGEM, então em party (#191) o id leva o dono no meio — dois
      // membros com `lootSeq` 0 colidiriam. Em solo o formato é o de sempre. O critério é o
      // TIPO de sessão, não a contagem de presentes (DT-03, #397): uma party pode ficar
      // momentaneamente com 1 presente e depois crescer de novo por join em curso, e o formato
      // de solo colidiria com o de quem entrar depois.
      const instanceId = this.#party !== undefined
        ? `${session.id}:${character.id}:${String(character.lootSeq++)}`
        : `${session.id}:${String(character.lootSeq++)}`;
      const carried: CarriedItem = {
        instanceId,
        itemId: rolled.itemId,
        quantity: rolled.quantity,
      };
      // Conta no ANALISADOR aconteça o que acontecer com o destino: o item caiu, e é isso que
      // o §16.1 chama de loot. Contar só o que coube faria a mochila cheia parecer hunt ruim.
      session.credit(character.id, 'itemsLooted', carried.quantity);

      if (character.inventory.add(carried, this.#options.items, wearer, this.#containerRules(character)).ok) continue;

      // Não coube: vai para a caixa. Ela é da SESSÃO — encerrar começa o relógio de 30
      // minutos —, e por isso o item ainda não é uma instância no banco: expirar precisa
      // significar que ele nunca existiu, não que existe e ninguém consegue ver.
      character.lootBox.push(carried);
      const runner = this.#runnerOf(character.id);
      if (runner.warnedFullBackpack) continue;
      runner.warnedFullBackpack = true;
      // UMA linha no extrato, como o aviso de stamina. Uma por item encheria a lista curta da
      // tela de retorno até ela deixar de ser lista — e o que o jogador precisa saber é que a
      // mochila encheu, não qual das trinta flechas ficou de fora.
      session.record('backpack-full', character.id);
    }
    // Gatilho do §13: o loot pessoal mudou o peso da mochila, e com ele a capacidade disponível
    // e as reservas da party. No-op quando não há bolsa, que é o caso de hoje.
    this.#rebalanceBag(session);
  }

  /** Os tamanhos de container deste personagem (#160): a mochila que ele veste, e a tabela. */
  #containerRules(character: CharacterRuntime): ContainerRules {
    return containerRulesFor(character.inventory, this.#options.items, this.#options.progression);
  }

  #vocationOf(character: CharacterRuntime): Vocation | null {
    if (character.vocationId === null) return null;
    // Vocação que saiu do conteúdo cai para a tabela base em vez de derrubar a hunt: perder
    // stats é ruim, perder a sessão inteira de quem estava caçando é pior.
    return this.#options.vocations.get(character.vocationId) ?? null;
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
      // A resistência e a imunidade do EQUIPAMENTO (CMB-03), compiladas na hora do golpe a
      // partir dos poucos slots vestidos — não é varredura de tabela de resistência.
      mitigation: character.inventory.mitigation(this.#options.items),
      // A fonte de defesa (CMB-04): escolhida pelo `Inventory` (DT-01) e escalada aqui pela
      // skill de shielding, que é do ruleset porque vive no personagem.
      defense: this.#defenseSourceOf(character),
    };
  }

  /**
   * O Energy Ring no dedo (§13.9, SV-16): a segunda fonte de mana shield, resolvida pelo
   * catálogo — `CharacterRuntime` não conhece conteúdo. Entra em `applyDamageOutcome` como a
   * mesma leitura OU-lógica da condição `mana-shield`, e nunca soma com ela.
   */
  #hasEnergyShield(character: CharacterRuntime): boolean {
    return character.inventory.ringEffect(this.#options.items)?.kind === 'energy-shield';
  }

  /**
   * A fonte de defesa do personagem (CMB-04), já escalada pela skill de shielding.
   *
   * A ESCOLHA é do `Inventory` (DT-01): escudo, arma de uma mão, nenhuma — uma regra só, a
   * mesma que já recusa bow com escudo. Aqui entra o que é do ruleset: a skill que o conteúdo
   * apontou em `combat.defense.skillId` multiplica a defesa da peça, como a skill de arma
   * multiplica o ataque. Sem skill (conteúdo de teste, ou referência ausente), a peça vale o
   * que ela diz.
   */
  #defenseSourceOf(character: CharacterRuntime): DefenseSource {
    const source = character.inventory.defenseSource(this.#options.items, character);
    if (source.kind === 'none') return source;
    const skillId = this.#options.combat.defense?.skillId;
    if (skillId === undefined) return source;
    const skill = this.#options.skills.get(skillId);
    if (skill === undefined) return source;
    return {
      kind: source.kind,
      defense: Math.round(source.defense * powerMultiplier(skill, character.skills.levelOf(skill))),
    };
  }

  /**
   * Em quem bater AGORA: o alvo escolhido, se vivo e ao alcance; senão o melhor da política
   * dentro do alcance da arma (FUN-85).
   *
   * Era `#nearestMonster`, e a política era o motor. Agora ela vem da configuração — e
   * `nearest` continua sendo o padrão, então uma hunt sem bot se comporta exatamente como
   * antes. O desempate segue estável, e é `selectTarget` que o garante.
   *
   * Alvo do JOGADOR fora do alcance devolve `null` em vez de cair na política: quem mandou
   * seguir um não quer bater em outro no caminho — quem o leva até lá é `#approachTarget`, na
   * postura `follow` (ADR 0032 d.5). Alvo do AUTO-TARGET (#444) é só a mira corrente: fora do
   * alcance da arma, o golpe cai no melhor da política, e é isso que mantém o corpo a corpo
   * batendo no monstro colado enquanto a runa espera o alvo distante.
   */
  #attackTarget(character: CharacterRuntime): MonsterRuntime | null {
    // O alvo explícito (jogador ou bot, #470/#480) vem primeiro. O pinned do JOGADOR é
    // EXCLUSIVO: fora do alcance devolve `null` em vez de cair na política. O eleito pelo bot
    // NÃO é — fora do alcance ele cede para o candidato/política, e é isso que mantém o corpo
    // a corpo batendo no monstro colado enquanto o bot mira um alvo distante (#444).
    const attack = this.#attackTargetOfRunner(character);
    if (attack !== null) {
      if (distance(character.position, attack.position) <= this.#attackRangeOf(character)) {
        return attack;
      }
      if (this.#isPinned(character)) return null;
    }
    // O candidato do auto-target (#444) é só a mira corrente: fora do alcance da arma, o golpe
    // cai no melhor da política, e é isso que mantém o corpo a corpo batendo no monstro colado
    // enquanto a runa espera o alvo distante.
    const candidate = this.#botCandidateOf(character);
    if (candidate !== null
      && distance(character.position, candidate.position) <= this.#attackRangeOf(character)) {
      return candidate;
    }
    return selectTarget(
      this.#targetingOf(character), this.#monsters, character.position, this.#attackRangeOf(character),
    );
  }

  /**
   * O monstro vivo, dentro do raio de busca; senão `null`. **NÃO muta** — é a leitura que
   * `selectedTargetOf` usa para a apresentação (invariante 3).
   */
  #liveTargetOf(subject: string | null, character: CharacterRuntime): MonsterRuntime | null {
    if (subject === null) return null;
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return null;
    if (distance(character.position, monster.position) > (this.#options.targetSearchRadius ?? 8)) {
      return null;
    }
    return monster;
  }

  /** O alvo de ATAQUE vivo; limpa o campo se morreu ou saiu da tela. `null` se não há. */
  #attackTargetOfRunner(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || runner.attackTarget === null) return null;
    const monster = this.#liveTargetOf(runner.attackTarget, character);
    if (monster === null) {
      runner.attackTarget = null;
      runner.attackTargetPinned = false;
    }
    return monster;
  }

  /** O candidato do AUTO-TARGET vivo; limpa o campo se morreu ou saiu da tela. */
  #botCandidateOf(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || runner.botCandidate === null) return null;
    const monster = this.#liveTargetOf(runner.botCandidate, character);
    if (monster === null) runner.botCandidate = null;
    return monster;
  }

  /** O alvo corrente é do JOGADOR (AB-09), ou só uma eleição do bot (#480)? */
  #isPinned(character: CharacterRuntime): boolean {
    const runner = this.#runners.get(character.id);
    return runner !== undefined && runner.attackTarget !== null && runner.attackTargetPinned;
  }

  /**
   * O alcance é da ARMA (#152): o bow alcança 6, wand e rod 3, e o desarmado vale o alcance
   * do perfil `fist` (CMB-05) — que o boot monta de `combat.player.attackRange`, o corpo a
   * corpo. A arma sem `range` já saiu do boot com o da família.
   */
  #attackRangeOf(character: CharacterRuntime): number {
    return character.inventory.weapon(this.#options.items, character)?.weapon?.range
      ?? this.#options.unarmed.range;
  }

  /**
   * Atrás de quem ANDAR: o alvo escolhido primeiro (para "seguir" fora do alcance), senão o
   * melhor dentro do raio de visão.
   *
   * Só é consultado quando a postura não é `stand`. Separar dos dois é o que destravou esta
   * issue: enquanto a busca parava no alcance da arma, "seguir o alvo" não tinha como ser
   * expresso — quem já está ao alcance não precisa ser seguido.
   */
  #approachTarget(character: CharacterRuntime): MonsterRuntime | null {
    const attack = this.#attackTargetOfRunner(character);
    if (attack !== null) return attack;
    const candidate = this.#botCandidateOf(character);
    if (candidate !== null) return candidate;
    return selectTarget(
      this.#targetingOf(character), this.#monsters, character.position, this.#options.targetSearchRadius ?? 8,
    );
  }

  /**
   * Auto-target (#444): sem alvo de ataque válido, seleciona o melhor monstro na TELA — o raio
   * de busca, o mesmo de `#approachTarget` — e o guarda. É o que faz um monstro que surge ao
   * longe virar alvo na hora, mesmo fora do alcance da arma: quem o leva até lá é
   * `#attackTarget`/`#targetInRange`, cada um com o seu alcance.
   *
   * A eleição passa por `setAttackTarget(..., pinned: false)` (#480, §42): o bot entra pelo
   * MESMO pipeline do jogador, mas sem pinar — fora do alcance a política reassume. O
   * `botCandidate` continua sendo a mira de tela, e é ele que sobrevive ao cancelamento do
   * jogador. NÃO sobrepõe o alvo pinado do jogador: com um `attackTarget` vivo e na tela, sai
   * sem tocar em nada. Quando ele morre ou sai da tela, `#attackTargetOfRunner` limpa o campo e
   * a chamada seguinte já reavalia para o próximo mais próximo.
   */
  #autoSelectTarget(session: Session, character: CharacterRuntime): void {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || !character.alive) return;
    // Valida e limpa os dois campos; com um alvo explícito ou um candidato vivo, nada a fazer.
    if (this.#attackTargetOfRunner(character) !== null) return;
    if (this.#botCandidateOf(character) !== null) return;

    const best = this.#approachTarget(character);
    const next = best === null ? null : best.subject;
    if (next === runner.botCandidate) return;
    runner.botCandidate = next;
    // A troca de alvo do bot entra pela porta única (#480): jogador e bot não têm pipelines
    // que divergem. `false` porque é eleição de política, não clique.
    this.setAttackTarget(character, best, false);
    if (next === null) return;
    // O alvo novo pode destravar uma regra e um golpe engatilhados: reavalia agora, e não no
    // próximo múltiplo de um relógio.
    this.#armBot(session, character.id);
    this.#armPlayerAttack(session, character);
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
  /**
   * Onde um monstro NÃO nasce (#236): parede, tile ocupado — e, com `spawnClearRadius` > 0,
   * qualquer tile a menos disso de um participante vivo. Sem o terceiro, o rato nascia no
   * tile ao lado do herói e, com `respawnDelayMs` igual ao intervalo de ataque, morria no
   * MESMO instante em que nascia (`Spawn` vence antes de `Attack`): o cliente recebia
   * appear + hit + disappear num lote só e desenhava o dano num tile vazio.
   *
   * Recusar aqui é ADIAR, não cancelar: `#onSpawn` reagenda em `SPAWN_RETRY_MS`. A densidade
   * continua sendo a da dificuldade — é a diferença para a supressão que a referência (§29)
   * manda não copiar. Morto não conta: ele está saindo, e um cadáver que segura o spawn
   * seria um raio que ninguém vê.
   */
  #spawnBlockedFor(session: Session): Blocked {
    const radius = this.#options.hunt.spawnClearRadius;
    return (x, y) => {
      if (isBlocked(this.#options.map, x, y) || this.#world.occupied(x, y)) return true;
      if (radius <= 0) return false;
      for (const participant of session.participants) {
        if (participant.alive && distance(participant.position, { x, y }) < radius) return true;
      }
      return false;
    };
  }

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
  readonly botConfig?: BotConfigInput;
  /** A de cada participante, por id (#203). Ver `HuntRulesetOptions.botConfigs`. */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191). Ver `HuntRulesetOptions.partyOptions`. */
  readonly partyOptions?: PartyOptionsInput;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
}

export class HuntUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuntUnavailableError';
  }
}

/**
 * `onEnter` recusa join além do limite do conteúdo (#397, §22): TIPADO, ao contrário do
 * `throw new Error` de colocação (linha 1033) — aquele é falha de CONTEÚDO (o primeiro tile da
 * rota não existe; nunca deveria acontecer em produção); este é um caminho ESPERADO em toda
 * hunt de party madura, e o hospedeiro precisa distingui-lo para recusar o ticket em vez de
 * derrubar a sessão.
 */
export class PartyFullError extends Error {
  readonly maxMembers: number;
  constructor(huntId: string, maxMembers: number) {
    super(`party da hunt "${huntId}" já tem ${String(maxMembers)} membros (limite do conteúdo)`);
    this.name = 'PartyFullError';
    this.maxMembers = maxMembers;
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
  readonly botConfig?: BotConfigInput;
  /** A de cada participante, por id (#203). Ver `HuntRulesetOptions.botConfigs`. */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191). Ver `HuntRulesetOptions.partyOptions`. */
  readonly partyOptions?: PartyOptionsInput;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
}

export function createHuntRuleset(
  content: Content,
  huntId: string,
  difficulty: HuntDifficultyName,
  extras: HuntRulesetExtras = {},
): HuntRuleset {
  const { premium, botConfig, botConfigs, partyOptions, exitRules, actuator } = extras;
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
    weaponFamilies: content.weaponFamilies,
    unarmed: content.unarmed,
    // Opcional no conteúdo, opcional aqui — e a chave só existe quando há valor, por causa do
    // `exactOptionalPropertyTypes`.
    party: content.party,
    ...(content.bestiary === undefined ? {} : { bestiary: content.bestiary }),
    targetSearchRadius: content.bot.targetSearchRadius,
    spells: content.spells,
    supplies: content.supplies,
    ammunition: content.ammunition,
    player: { ...content.combat.player },
    ...(exitRules === undefined ? {} : { exitRules }),
    ...(premium === undefined ? {} : { premium }),
    ...(botConfig === undefined ? {} : { botConfig }),
    ...(botConfigs === undefined ? {} : { botConfigs }),
    ...(partyOptions === undefined ? {} : { partyOptions }),
    ...(actuator === undefined ? {} : { actuator }),
    // O cooldown de FALLBACK do grupo vem do CONTEÚDO (§13.5), como todo parâmetro de
    // balanceamento; o livro do conteúdo (`group:<g>`) tem precedência.
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
      ...(options.botConfigs === undefined ? {} : { botConfigs: options.botConfigs }),
      ...(options.partyOptions === undefined ? {} : { partyOptions: options.partyOptions }),
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
 * dinâmica, e não tente ser esperto aqui: mudar `monsterCount` no meio deixaria monstros da
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
): { readonly session: Session; readonly receipts: readonly Receipt[] } {
  const ruleset = session.ruleset;
  if (!(ruleset instanceof HuntRuleset)) {
    throw new Error(`sessão ${session.id} não é uma hunt`);
  }
  const state = ruleset.getState();
  const characters = [...session.participants];

  session.record('difficulty-changed', `${state.difficulty} → ${options.to}`);
  const receipts = session.end('manual-exit');

  const next = createHuntSession({
    id: options.newSessionId,
    content: options.content,
    huntId: state.huntId,
    difficulty: options.to,
    createdAtMs: options.nowMs,
  });
  for (const character of characters) next.enter(character);
  return { session: next, receipts };
}
