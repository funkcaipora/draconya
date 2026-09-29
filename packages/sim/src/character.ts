// Estado quente do personagem. A sessão dona é o único objeto que escreve aqui
// (invariante 9) — é também o que dispensa lock sobre o gold.

import type { AmmoFamily, Ammunition, Item, Vocation } from '@draconya/content';
import type { Direction } from './area.js';
import { FULL_BLOCK_CHARGE, isFullBlockCharge } from './combat/block-charge.js';
import type { BlockChargeState } from './combat/block-charge.js';
import { INITIAL_ATTACK_PRACTICE, isInitialAttackPractice } from './combat/attack-practice.js';
import type { AttackPracticeState } from './combat/attack-practice.js';
import { DEFAULT_FIGHT_MODE, isFightMode } from './combat/fight-mode.js';
import type { FightMode } from './combat/fight-mode.js';
import { Bestiary } from './bestiary.js';
import type { BestiaryState } from './bestiary.js';
import { Charms } from './charms.js';
import type { CharmsState } from './charms.js';
import { Conditions } from './conditions.js';
import type { ConditionState } from './conditions.js';
import { Cooldowns } from './cooldown.js';
import type { CooldownState } from './cooldown.js';
import { Contribution } from './death.js';
import type { ContributionState } from './death.js';
import { Inventory } from './inventory.js';
import type { CarriedItem, ContainerRules, InventoryState } from './inventory.js';
import { Skills } from './skills.js';
import type { SkillsState } from './skills.js';
import { UNSET_STORAGE_VALUE, readCharacterStorage } from './character-storage.js';
import type { CharacterStorageMap } from './character-storage.js';

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CharacterState {
  readonly id: string;
  readonly position: Point;
  readonly health: number;
  readonly maxHealth: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly level: number;
  /** XP ACUMULADA, não o progresso dentro do level. Ver `progression.ts` (FUN-37). */
  readonly xp: number;
  /**
   * Pontos de alma (#593), o `spell:soul(n)` do Canary — hoje só a plumbing: nenhuma magia do
   * catálogo real ainda declara `soulCost` (a conjuração é a #594). PODE DESCER — é gasto, não
   * progressão monotônica como skill/Bestiário — e por isso o extrato o leva como valor
   * ABSOLUTO, última-escrita-vence, nunca fundido por máximo no ledger (ver `receipts.ts`).
   *
   * Opcional: personagem e snapshot anteriores a esta issue não têm a chave, e `0` é onde todo
   * personagem sem vocação está — o Tibia sempre tem vocação e por isso sempre tem alma; aqui
   * o personagem nasce sem uma (§7.4), e `chooseVocation` é quem a enche pela primeira vez.
   */
  readonly soul?: number;
  /**
   * A vocação escolhida, ou ausente enquanto não há uma — o personagem nasce sem e escolhe no
   * level 8 (§7.4).
   *
   * Opcional, e não `string | null` obrigatório, porque snapshot gravado antes da FUN-37 não
   * tem a chave. Ausente e `null` querem dizer a mesma coisa aqui — "sem vocação" —, então o
   * formato antigo continua legível e o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
   */
  readonly vocationId?: string | null;
  /**
   * A Boosted Creature do dia em que este personagem entrou no jogo (M42, #615, ADR 0052
   * decisão 5): vem do ticket, FIXADA aqui como a versão de conteúdo (invariante 7) — e não
   * relida do mundo a cada transição Cidade↔hunt, para a hunt que atravessa a virada continuar
   * com a boosted com que nasceu (ADR 0054 decisão 7). Ausente é ticket sem o dado (conteúdo
   * sem `boosted/baseline.json`, ou `api` antigo em deploy em rolagem): nenhuma hunt deste
   * personagem aplica o bônus.
   */
  readonly boostedMonsterId?: string;
  /**
   * Stamina que sobrava em `staminaUpdatedAtMs`, em milissegundos (§10). NÃO é decrementada
   * por ninguém fora da hunt: o valor de agora é calculado na leitura (ver `stamina.ts`).
   *
   * `null` — e ausente — significa "sem stamina rastreada", que é o que uma sessão gravada
   * antes da FUN-39 é. Ela roda sem teto até acabar, o que é preferível a inventar um valor
   * e cobrar de alguém uma stamina que nunca foi medida.
   */
  readonly staminaMs?: number | null;
  /** Instante de RELÓGIO (epoch) em que `staminaMs` valia. Não é o relógio da simulação. */
  readonly staminaUpdatedAtMs?: number;
  /**
   * Velocidade na escala do Tibia (FUN-119). Vem de `statsForLevel`, copiada para cá como
   * `maxHealth` é: o sistema de movimento pergunta à criatura, e a criatura não conhece o
   * conteúdo. Opcional porque snapshot gravado antes da FUN-119 não tem a chave; quem restaura
   * repõe a partir do conteúdo.
   */
  readonly speed?: number;
  /**
   * Gold que o personagem TINHA ao entrar na sessão (FUN-77). Vem do ticket, nunca do cliente
   * (invariante 4), e não é escrito aqui: o que a sessão movimenta é `goldDelta`.
   *
   * Existe porque gastar exige saber o saldo, e o saldo é `gold + goldDelta`. Sem ele, uma
   * poção de 45 seria comprada por quem tem 10 e o delta ficaria negativo — o ledger
   * corrigiria depois, com o jogador já tendo bebido.
   *
   * Opcional: snapshot gravado antes desta issue não tem a chave, e ausente vira zero. A
   * degradação erra para o lado seguro — quem retoma uma sessão antiga não consegue gastar,
   * em vez de gastar o que não tem.
   */
  readonly gold?: number;
  /** Variação de gold desta sessão. Vira linha de ledger ao encerrar (invariante 10). */
  readonly goldDelta: number;
  readonly alive: boolean;
  /**
   * Skills que sobem por uso (§9.4, FUN-75). Ausente é snapshot ou personagem anterior a
   * elas — e aí toda skill vale o nível inicial do conteúdo, que é onde um personagem novo
   * começa. Opcional, então o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
   */
  readonly skills?: SkillsState;
  /**
   * Abates por monstro, PERMANENTES (§18, FUN-113). Ausente é snapshot ou personagem anterior
   * ao Bestiário — nenhum abate contado, que é onde um personagem novo começa. Opcional, então
   * o `SNAPSHOT_FORMAT_VERSION` não precisou subir (DT-06), exatamente como `skills`.
   */
  readonly bestiary?: BestiaryState;
  /**
   * A economia de Charms (M39-02, #602, ADR 0052 d.1): pontos/echoes gastos, tier de cada
   * charm e as atribuições por monstro. Ausente é personagem anterior a esta issue, ou que
   * nunca gastou um ponto de Charm — a mesma degradação de `bestiary`.
   */
  readonly charms?: CharmsState;
  /**
   * Quanto ele aguenta carregar (§21.5). Vem da tabela de progressão, como `maxHealth`.
   *
   * Opcional: personagem e snapshot anteriores ao inventário não têm a chave, e zero seria
   * "não carrega nada" — o que travaria a mochila de quem já jogava. Quem restaura repõe a
   * partir do conteúdo, como faz com `speed`.
   */
  readonly capacity?: number;
  /**
   * Mochila e equipamento (FUN-82). Ausente é personagem sem item nenhum, que é o normal até a
   * primeira issue que DÁ item a alguém.
   */
  readonly inventory?: InventoryState;
  /**
   * As instâncias que `sell-items`/`discard-item` destruíram nesta sessão, ainda não drenadas
   * para um extrato (#724, ADR 0048 d.8). Ausente é nenhuma — o normal —, sem bump de
   * `SNAPSHOT_FORMAT_VERSION`. Drenada por `drainRemovedInstances`, como `goldDelta` drena para
   * `aggregates.goldGained`/`goldSpent`.
   */
  readonly removedInstances?: readonly string[];
  /**
   * Quantos itens esta sessão já criou. Vira parte do id da instância.
   *
   * Precisa do snapshot: sem ele, uma sessão retomada recomeçaria a contagem e geraria o mesmo
   * id de novo — e como a inserção é idempotente por id, o item novo seria silenciosamente
   * descartado por parecer repetido.
   */
  readonly lootSeq?: number;
  /** Quem bateu nele e quanto (FUN-63). Ausente é snapshot anterior: atribuição vazia. */
  readonly contribution?: ContributionState;
  /**
   * A munição escolhida por família (#152, ADR 0026 decisão 3): `{ arrow: 'sniper-arrow' }`.
   *
   * A munição é ABSTRATA (gold no tiro, sem pilha). Ausente, ou família sem chave, é a munição
   * BÁSICA da família — o padrão de quem nunca escolheu. Viaja no snapshot e no extrato como a
   * vocação; opcional, e por isso o `SNAPSHOT_FORMAT_VERSION` continua o mesmo.
   */
  readonly ammo?: Readonly<Partial<Record<AmmoFamily, string>>>;
  /**
   * O ESTOQUE de supply que caiu em loot (#520): `supplyId → quantidade`, creditado por quem
   * recebe o drop (`rollLoot`/`LootSupply`, `packages/sim/src/loot.ts`). Supply continua
   * abstrato no CATÁLOGO (AB-01, ADR 0032 d.6: sem pilha própria) — mas `useSupply` (revisão do
   * #536) gasta DESTE estoque primeiro, e só cobra gold quando ele acaba: uma Strong Health
   * Potion caída do Dragon é usável de verdade, não só um número que credita e nunca se gasta.
   * Ausente é nenhum estoque, sem bump de `SNAPSHOT_FORMAT_VERSION`. Persistido em
   * `character.supply_stock` (jsonb) — ver `packages/server/src/db/schema.ts`.
   */
  readonly supplyStock?: Readonly<Record<string, number>>;
  /**
   * O ESTOQUE de munição FÍSICA que caiu em loot (#520): `ammunitionId → quantidade`, a mesma
   * forma e a mesma regra do `supplyStock` — munição continua abstrata no TIRO (ADR 0026 d.7:
   * cada disparo debita `price` do gold por família escolhida, sem item físico), mas o que caiu
   * em loot (Burst Arrow, Power Bolt) é gasto ANTES do gold, uma unidade por tiro daquela
   * família. Ausente é nenhum estoque, sem bump de `SNAPSHOT_FORMAT_VERSION`. Persistido em
   * `character.ammunition_stock` (jsonb).
   */
  readonly ammunitionStock?: Readonly<Record<string, number>>;
  /**
   * Storages por personagem (#731, ADR 0050 d.6 T2): `storageKey → value` — a semente do motor
   * de quest, a mesma pergunta do Canary (`player:getStorageValue`). Ausente é NENHUM storage
   * setado, sem bump de `SNAPSHOT_FORMAT_VERSION` — a mesma degradação de `bestiary`/`ammo`.
   * Persistido em `character_storage` (uma linha por chave, não uma coluna `jsonb`): ver
   * `packages/server/src/db/schema.ts`.
   */
  readonly storages?: CharacterStorageMap;
  readonly cooldowns: Partial<CooldownState>;
  /**
   * Para onde o personagem olha (#155): é de onde saem onda, cleave e feixe. Gravada pelo passo
   * (`#step` do ruleset); ausente é `south`, a de quem nunca andou — e a de todo snapshot
   * anterior a #155.
   */
  readonly direction?: Direction;
  /**
   * Haste, postura, magic shield e cura ao longo do tempo (#155), com vencimento LÓGICO. O
   * evento que as faz vencer está na fila da sessão, que também vai no snapshot. Ausente é
   * nenhuma — sem bump de `SNAPSHOT_FORMAT_VERSION`.
   */
  readonly conditions?: readonly ConditionState[];
  /**
   * As cargas de bloqueio do `combat-v3` (#548, ADR 0040): `block-charge.ts`. Ausente é
   * `FULL_BLOCK_CHARGE` — o personagem que nunca bloqueou ainda, ou snapshot anterior a esta
   * issue. Sem bump de `SNAPSHOT_FORMAT_VERSION`, como `conditions`.
   */
  readonly blockCharge?: BlockChargeState;
  /**
   * A prática de ataque e de escudo do `combat-v3` (#686): `combat/attack-practice.ts`. Ausente é
   * `INITIAL_ATTACK_PRACTICE` — nasce a cada sessão, como no Canary, e só viaja no snapshot
   * QUENTE para a hunt retomada não perder o contador. Sem bump de `SNAPSHOT_FORMAT_VERSION`.
   */
  readonly attackPractice?: AttackPracticeState;
  /**
   * Quanto tempo de regeneração a comida ainda tem (#726, ADR 0049 decisão 5): a
   * `CONDITION_REGENERATION` do Tibia, em milissegundos, drenada por `drainFedMs`
   * (`packages/sim/src/food.ts`) pelo tempo LÓGICO de hunt decorrido — nunca por tick
   * (invariante 2), como a stamina. Ausente é `0` — sem comida, o personagem de sempre; sem
   * bump de `SNAPSHOT_FORMAT_VERSION`, como `blockCharge`/`attackPractice`. Só é CONSULTADA
   * quando `progression.regeneration.requiresFood` está ligada — comer sempre soma o contador,
   * ligado ou não, mas só a flag decide quem lê.
   */
  readonly fedMs?: number;
  /**
   * As sete bênçãos PvE compradas na Cidade (#570, ADR 0052 — substitui o executor de
   * `blessing-charge` do #726, removido): um BITMASK, um bit por `order` do catálogo
   * (`content.blessings`, `packages/sim/src/blessings.ts`), nunca uma contagem — a identidade
   * importa porque comprar de novo a mesma bênção é recusado, e só `blessingCount(mask)` entra
   * na redução da penalidade de morte (`applyDeathPenalty`, `progression.ts`).
   *
   * **DESCE**: `HuntRuleset#onCharacterDied` zera o campo inteiro na morte (o Tibia consome
   * TODAS de uma vez, nunca uma de cada vez) — é por isso que o extrato manda o valor absoluto
   * e o ledger NUNCA funde por máximo (ao contrário do Bestiário/skills, que só sobem): fundir
   * por máximo ressuscitaria bênção que acabou de ser consumida se um extrato antigo chegasse
   * depois. Ausente é `0`, sem bump de `SNAPSHOT_FORMAT_VERSION`, como `fedMs`.
   */
  readonly blessings?: number;
  /**
   * Um `use-item`/`use-item-on` ACEITO mas ADIADO pela exaustão de ação compartilhada (#726,
   * ADR 0049 decisão 6 — o `setNextActionTask` do Canary): agendado para o vencimento do livro
   * `exhaust:action`, como um evento `pending-manual-action` da fila (invariante 2). Um segundo
   * disparo antes do vencimento SUBSTITUI este campo e reagenda — nunca empilha dois. `ref`/
   * `target` usam a MESMA forma numérico-livre de `UseSlotTarget`/o `ref` de `use-item`
   * (`packages/sim/src/rulesets/hunt.ts`) — dado puro, sem instância de classe, por isso cabe
   * aqui sem `rulesets/hunt.ts` importar `character.ts` ao contrário. Ausente é nenhuma ação
   * pendente; sem bump de `SNAPSHOT_FORMAT_VERSION`, como `blockCharge`/`attackPractice`.
   */
  readonly pendingManualAction?: PendingManualActionState;
  /**
   * A trava de ataque ao trocar de andar (#554, M30-07, ADR 0040 decisão 1): instante ABSOLUTO
   * do relógio lógico até quando nem o golpe nem a magia AGRESSIVA saem — `Player::
   * onChangeZone`/`player.cpp:12417-12423` do Canary, `stairJumpExhaustion` (`config.lua.dist:45`).
   * Só `HuntRuleset#step` escreve, na troca de `z` ou no redirecionamento por teleporte, e só sob
   * `combat-v3` com `combat.stairhopDelayMs` declarado (`CombatCompatibilityProfile`/`combatSchema`
   * em `@draconya/content`). Ausente é `0` — nunca travado, o de sempre —, sem bump de
   * `SNAPSHOT_FORMAT_VERSION`, como `blockCharge`/`attackPractice`.
   */
  readonly attackLockedUntil?: number;
  /**
   * O último instante (relógio lógico da sessão) em que o personagem deu OU recebeu um ataque
   * — a definição ÚNICA de "em combate" do endgame (#625), lida por `isInFight`
   * (`combat/in-fight.ts`): `pzLocked` do Canary, 60 000 ms desde este carimbo. Escrito pelo
   * ruleset da hunt em `#land`/`#applyHits` (dado) e `#applyMonsterHit` (recebido) — a mesma
   * régua de `Runner.lastCombatActionAtMs` (`rulesets/hunt.ts`), mas NÃO o mesmo campo: aquele
   * é só DADO, sem self-heal, e alimenta só a elegibilidade de XP compartilhada (#525); este
   * soma o recebido e não exclui nada, porque apanhar também deveria travar a saída no Tibia.
   * Ausente é "nunca lutou nesta sessão" — sem bump de `SNAPSHOT_FORMAT_VERSION`, como
   * `attackLockedUntil`.
   */
  readonly lastCombatActionAtMs?: number;
  /**
   * Promovido (#566, ADR 0042 decisão 1): estado que SÓ SOBE — não existe des-promoção no
   * Tibia. Ausente/`false` é "não promovido", o normal de todo personagem novo. Sem bump de
   * `SNAPSHOT_FORMAT_VERSION`, como `vocationId`/`blessings`.
   */
  readonly promoted?: boolean;
  /**
   * A postura de luta (M30-03, #550): o `fightMode` do Canary — ofensiva, balanceada ou
   * defensiva —, escolhida pelo jogador com `set-fight-mode` e persistida em
   * `character.fight_mode`. Escala o dano de arma (`attackFactor`), a defesa e a mitigação do
   * `combat-v3` (`combat/fight-mode.ts`). Ausente é `'attack'`, o `FIGHTMODE_ATTACK` que o
   * Canary usa quando ninguém escolheu (`player.hpp:1857`) — sem bump de
   * `SNAPSHOT_FORMAT_VERSION`, como `promoted`.
   */
  readonly fightMode?: FightMode;
  /**
   * O instante (relógio lógico da sessão) do último golpe de ARMA do personagem — o `lastAttack`
   * do Canary (`Player::updateLastAttack`, escrito só por `doAttacking` quando `useWeapon`/
   * `useFist` devolve `true`), de onde sai o fator de defesa DINÂMICO da postura ofensiva e
   * balanceada (`attackedRecently`, `combat/fight-mode.ts`). Só o ruleset da hunt escreve, no
   * evento do golpe (invariante 9). Ausente é "nunca bateu nesta sessão" (fator 1,0) — o
   * relógio é da sessão, então não sobrevive à troca de sessão nem vai para o Postgres, só no
   * snapshot QUENTE, para a hunt retomada não perder a janela. Na transição o personagem é o
   * MESMO objeto e o relógio da sessão nova nasce em zero: por isso `Session.enter` zera o
   * carimbo (o restore de snapshot não passa por `enter`, e a janela quente atravessa). Sem bump
   * de `SNAPSHOT_FORMAT_VERSION`, como `lastCombatActionAtMs`.
   */
  readonly lastAttackAtMs?: number;
}

/** Ver `CharacterState.pendingManualAction`. */
export interface PendingManualActionState {
  readonly kind: 'item' | 'item-on';
  readonly ref: { readonly instanceId: string } | { readonly supplyId: string };
  readonly target?:
    | { readonly kind: 'monster'; readonly subject: string }
    | { readonly kind: 'character'; readonly characterId: string }
    | { readonly kind: 'position'; readonly position: { readonly x: number; readonly y: number; readonly z?: number } }
    | { readonly kind: 'invalid' };
  readonly seq: number;
}

/** Por que a munição não foi escolhida. Tipada: o jogador merece saber qual foi. */
export type AmmoRefusal = 'level-too-low';
export type AmmoResult = { readonly ok: true } | { readonly ok: false; readonly reason: AmmoRefusal };

/** Por que a vocação não foi escolhida (#154). Tipada: o jogador merece saber qual foi. */
export type VocationRefusal = 'level-too-low' | 'already-chosen';

/** Por que a promoção não aconteceu (#566, ADR 0042 decisão 1). Tipada, como o resto. */
export type PromoteRefusal =
  | 'no-vocation' | 'already-promoted' | 'level-too-low' | 'insufficient-gold' | 'not-promotable';
export type PromoteResult = { readonly ok: true } | { readonly ok: false; readonly reason: PromoteRefusal };

/**
 * Como uma peça do kit inicial acabou (#496). `equipped` vestiu; `in-backpack` coube no
 * inventário mas não vestiu — o escudo do Paladin, impedido pelo bow de duas mãos. Peso nunca
 * recusa (ADR 0048 decisão 7, `Inventory.forceAdd`): a escolha de vocação não é punida pela
 * mochila.
 */
export type VocationPieceStatus = 'equipped' | 'in-backpack';

export interface VocationPieceResult {
  readonly itemId: string;
  readonly status: VocationPieceStatus;
}

export type VocationResult =
  | {
      readonly ok: true;
      readonly weapon: 'equipped' | 'in-backpack' | 'none';
      /**
       * O destino de cada peça do kit, na ordem do conteúdo (#496). Ausente é a arma legada da
       * #154 — o caminho de `weapon`; o kit completo não o usa.
       */
      readonly kit?: readonly VocationPieceResult[];
    }
  | { readonly ok: false; readonly reason: VocationRefusal };

export interface VocationChoiceOptions {
  readonly catalog: ReadonlyMap<string, Item>;
  /** `progression.vocationLevel` — quem tem o conteúdo lê e passa; o `sim` não conhece a tabela aqui. */
  readonly vocationLevel: number;
  /** A identidade da arma nova — decidida por quem conhece a sessão (ver a spec da #154, DT-03). */
  readonly instanceId: string;
  /** Os tamanhos de container (#160), para a arma achar lugar. */
  readonly rules: ContainerRules;
  /**
   * O kit completo da vocação (#496), na ordem do conteúdo — a ordem é contrato: o escudo é
   * equipado DEPOIS da arma, e é por isso que o bow o deixa na mochila e não o contrário.
   *
   * O `slot` da peça é declaração de conteúdo; o slot de verdade sai do item (`equip` lê a
   * definição), e o boot (`buildContent`) já recusou a peça declarada no lugar errado. Ausente
   * é a arma legada da #154 — `weapon` no argumento.
   */
  readonly kitItems?: ReadonlyArray<{ readonly item: Item }>;
}

export class CharacterRuntime {
  readonly id: string;
  position: Point;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  soul: number;
  vocationId: string | null;
  /** Ver `CharacterState.boostedMonsterId`. Nunca escrito depois da construção — fixado. */
  readonly boostedMonsterId?: string;
  staminaMs: number | null;
  staminaUpdatedAtMs: number;
  /** Saldo-base privado; só `settleGoldDelta` pode incorporá-lo ao extrato já aceito. */
  #gold: number;
  goldDelta: number;
  alive: boolean;
  speed: number;
  /** Mutadas no lugar a cada uso — ver `Skills.gain`. */
  readonly skills: Skills;
  /** Mutado no lugar a cada abate recompensado — ver `Bestiary.record`. */
  readonly bestiary: Bestiary;
  /** Mutado no lugar a cada intenção de Charm aceita — ver `Charms.unlock`/`assign`/`remove`. */
  readonly charms: Charms;
  capacity: number;
  /** Mutado ao equipar e ao receber item. Só a sessão dona escreve (invariante 9). */
  readonly inventory: Inventory;
  lootSeq: number;
  /** As instâncias destruídas por vender/descartar, ainda não drenadas. Ver `CharacterState.removedInstances`. */
  removedInstances: string[];
  /** Mutada no lugar a cada golpe — ver `recordDamage`. */
  readonly contribution: Contribution;
  /**
   * A munição escolhida por família. Só a sessão dona escreve (`selectAmmo`); a ausência de uma
   * família cai na básica da família na hora do tiro.
   */
  readonly ammo: Map<AmmoFamily, string>;
  /** O estoque de supply do loot (#520). Só a sessão dona escreve — ver `CharacterState.supplyStock`. */
  readonly supplyStock: Map<string, number>;
  /** O estoque de munição do loot (#520). Ver `CharacterState.ammunitionStock`. */
  readonly ammunitionStock: Map<string, number>;
  /**
   * Storages por personagem (#731). Só a sessão dona escreve (`setStorageValue`) — a mesma
   * régua de `ammo`/`supplyStock`. Ver `CharacterState.storages`.
   */
  readonly storages: Map<string, number>;
  readonly cooldowns: Cooldowns;
  /** Para onde olha. Só o passo escreve. */
  direction: Direction;
  /** Mutadas pelo ruleset ao lançar e ao vencer — ver `Conditions`. */
  readonly conditions: Conditions;
  /**
   * As cargas de bloqueio do `combat-v3` (#548). Só `applyDamageOutcome` escreve (CMB-08,
   * invariante 9) — ver `CharacterState.blockCharge`.
   */
  blockCharge: BlockChargeState;
  /**
   * A prática de ataque e de escudo do `combat-v3` (#686). Só o ruleset da hunt escreve, no
   * evento do golpe (invariante 9) — ver `CharacterState.attackPractice`.
   */
  attackPractice: AttackPracticeState;
  /** Comida ativa (#726). Só `drainFedMs`/`feed` (`food.ts`) escrevem — invariante 9. */
  fedMs: number;
  /** Bitmask de bênçãos (#570). Só o ruleset de Cidade (compra) e a morte (consumo) escrevem. */
  blessings: number;
  /** A ação manual adiada (#726). `null` é nenhuma. Só o ruleset escreve. */
  pendingManualAction: PendingManualActionState | null;
  /**
   * A trava de stairhop (#554). Só `HuntRuleset#step` escreve — ver `CharacterState.attackLockedUntil`.
   */
  attackLockedUntil: number;
  /**
   * Ver `CharacterState.lastCombatActionAtMs`. Só o ruleset da hunt escreve (invariante 9);
   * `null` é "nunca lutou".
   */
  lastCombatActionAtMs: number | null;
  /**
   * Promovido (#566, ADR 0042 decisão 1). Só `promote()` escreve — nunca desce. Consumido pelo
   * regen (`#regenOf`) e pela penalidade de morte (`applyDeathPenalty`), os dois em `hunt.ts`.
   */
  promoted: boolean;
  /**
   * A postura de luta (M30-03, #550). Só `setFightMode` escreve, e só a sessão dona a chama
   * (invariante 9) — pela intenção `set-fight-mode`, na Cidade e na hunt. Ver
   * `CharacterState.fightMode`.
   */
  fightMode: FightMode;
  /**
   * Ver `CharacterState.lastAttackAtMs`. Só o ruleset da hunt escreve (invariante 9) e
   * `Session.enter` zera; `null` é "nunca bateu nesta sessão".
   */
  lastAttackAtMs: number | null;

  constructor(state: CharacterState) {
    this.id = state.id;
    this.position = state.position;
    this.health = state.health;
    this.maxHealth = state.maxHealth;
    this.mana = state.mana;
    this.maxMana = state.maxMana;
    this.level = state.level;
    this.xp = state.xp;
    this.soul = state.soul ?? 0;
    this.vocationId = state.vocationId ?? null;
    if (state.boostedMonsterId !== undefined) this.boostedMonsterId = state.boostedMonsterId;
    this.staminaMs = state.staminaMs ?? null;
    this.staminaUpdatedAtMs = state.staminaUpdatedAtMs ?? 0;
    this.#gold = state.gold ?? 0;
    this.goldDelta = state.goldDelta;
    this.alive = state.alive;
    // Zero é "não sabe ainda": quem tem o conteúdo (o ruleset, ao entrar ou no primeiro
    // evento) repõe pela tabela de progressão.
    this.speed = state.speed ?? 0;
    this.skills = Skills.fromState(state.skills);
    this.bestiary = Bestiary.fromState(state.bestiary);
    this.charms = Charms.fromState(state.charms);
    this.capacity = state.capacity ?? 0;
    this.inventory = Inventory.fromState(state.inventory);
    this.lootSeq = state.lootSeq ?? 0;
    this.removedInstances = [...(state.removedInstances ?? [])];
    this.contribution = Contribution.fromState(state.contribution);
    this.ammo = new Map(Object.entries(state.ammo ?? {}) as [AmmoFamily, string][]);
    this.supplyStock = new Map(Object.entries(state.supplyStock ?? {}));
    this.ammunitionStock = new Map(Object.entries(state.ammunitionStock ?? {}));
    // Defensivo, como `readItemOverlay`: uma chave torta (valor não inteiro, ou o `-1` de
    // ausência gravado por engano) some da leitura em vez de travar a sessão inteira.
    this.storages = new Map(Object.entries(readCharacterStorage(state.storages) ?? {}));
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
    this.direction = state.direction ?? 'south';
    this.conditions = Conditions.fromState(state.conditions);
    this.blockCharge = state.blockCharge ?? FULL_BLOCK_CHARGE;
    this.attackPractice = state.attackPractice ?? INITIAL_ATTACK_PRACTICE;
    this.fedMs = state.fedMs ?? 0;
    this.blessings = state.blessings ?? 0;
    this.pendingManualAction = state.pendingManualAction ?? null;
    this.attackLockedUntil = state.attackLockedUntil ?? 0;
    this.lastCombatActionAtMs = state.lastCombatActionAtMs ?? null;
    this.promoted = state.promoted ?? false;
    // Defensivo, como `readCharacterStorage`: um valor que não é um dos três modos (snapshot
    // gravado à mão, ticket torto) vira o default do Canary em vez de travar a sessão.
    this.fightMode = isFightMode(state.fightMode) ? state.fightMode : DEFAULT_FIGHT_MODE;
    this.lastAttackAtMs = state.lastAttackAtMs ?? null;
  }

  /** Haste (#155): o multiplicador que `movementDuration` lê. `speed` continua sendo a base da tabela. */
  get speedScale(): number {
    return this.conditions.speedScale();
  }

  /**
   * Invisível (#592) — o que `Prey.invisible` (`monster/monster.ts`) lê em `chooseTarget`: um
   * monstro sem `seesInvisible` não seleciona nem retém este personagem como alvo enquanto isto
   * for `true`. Reconhecida pela chave reservada da condição, como `speedScale`/`hasManaShield`.
   */
  get invisible(): boolean {
    return this.conditions.hasInvisible();
  }

  /** Saldo de entrada visível ao motor. A sessão só movimenta `goldDelta`. */
  get gold(): number {
    return this.#gold;
  }

  /**
   * Incorpora a variação cujo extrato já foi aceito pelo hospedeiro.
   *
   * Não é ação de jogo nem pode ser chamada durante um tick: ela existe para a troca de
   * sessão manter a mesma instância quente coerente enquanto o ledger durável a liquida.
   */
  settleGoldDelta(): void {
    this.#gold += this.goldDelta;
    this.goldDelta = 0;
  }

  /**
   * Devolve as instâncias destruídas por `sell-items`/`discard-item` e esvazia a lista
   * (#724, ADR 0048 d.8) — chamado só quando o extrato que as carrega foi aceito, a mesma
   * disciplina de `settleGoldDelta` (invariante 10): perder a chamada por uma falha de
   * persistência não é problema, porque o `DELETE` que o `jobs` roda é idempotente por id.
   */
  drainRemovedInstances(): string[] {
    const drained = this.removedInstances;
    this.removedInstances = [];
    return drained;
  }

  /**
   * Escolhe a munição da família dela (#152). Só o level é conferido: a família é da munição,
   * e a arma na mão não precisa existir ainda — o seletor só aparece com o bow, mas a escolha
   * é guardada sempre. Sem gold para ela, o tiro não sai (o ruleset decide isso a cada tiro,
   * não aqui): não existe munição grátis.
   */
  selectAmmo(ammo: Ammunition): AmmoResult {
    if (ammo.requires.level !== undefined && this.level < ammo.requires.level) {
      return { ok: false, reason: 'level-too-low' };
    }
    this.ammo.set(ammo.family, ammo.id);
    return { ok: true };
  }

  /**
   * O valor deste storage, ou `-1` (convenção do Tibia) para quem nunca setou (#731). Nunca
   * lança: uma quest que ainda não existe consultando uma chave nova só lê "nunca setado".
   */
  getStorageValue(key: string): number {
    return this.storages.get(key) ?? UNSET_STORAGE_VALUE;
  }

  /**
   * Seta o storage (#731). `-1` APAGA a chave — é o valor de ausência, guardá-lo seria
   * indistinguível de "nunca setado" e só infla o extrato e a tabela à toa. Só a sessão dona
   * chama isto (invariante 9); a `-1` não vencer para pelo teto/piso de `value` cabe a quem
   * chama (conteúdo de quest), não a este método.
   */
  setStorageValue(key: string, value: number): void {
    if (value === UNSET_STORAGE_VALUE) this.storages.delete(key);
    else this.storages.set(key, value);
  }

  /**
   * Escolhe a vocação (#154, ADR 0026 decisão 1) — uma vez, no level da escolha ou depois.
   *
   * Os itens entram pelos caminhos que já existem: `forceAdd` (ignora peso — ADR 0048 decisão
   * 7) e `equip` (vocação, level, duas mãos). A escolha vale MESMO que um item não vista: com
   * escudo vestido e bow ele fica na mochila — perder a vocação por causa de peso seria punir
   * a decisão pela mochila, e é por isso que o peso nunca recusa aqui. `retarget` NÃO é
   * chamado: a tabela da vocação vale do próximo level em diante (`progression.ts`), e o
   * ruleset já lê `vocationId` a cada level up.
   *
   * Com `kitItems` (#496) é o kit completo que entra: cada peça ganha identidade própria
   * (`${instanceId}:${itemId}` — numa cópia da Cidade o id da sessão é compartilhado, e o id do
   * item no fim é o que não colide), `origin: 'vocation-choice'`, e o resultado reporta o
   * destino de cada uma. `weapon` é `null` quando nem kit nem arma existem — só no conteúdo de
   * teste.
   */
  chooseVocation(vocation: Vocation, weapon: Item | null, options: VocationChoiceOptions): VocationResult {
    if (this.vocationId !== null) return { ok: false, reason: 'already-chosen' };
    if (this.level < options.vocationLevel) return { ok: false, reason: 'level-too-low' };

    // A vocação PRIMEIRO: `equip` confere `requires.vocationId` contra `this.vocationId`, e a
    // arma exige exatamente a que está sendo escolhida.
    this.vocationId = vocation.id;
    // A alma nasce CHEIA (#593): o Tibia sempre tem vocação e por isso sempre tem alma; aqui
    // ela só existe a partir de agora, e o personagem que acabou de escolher não pode começar
    // devendo — é a mesma decisão de "vestir o kit completo", não "vestir aos poucos".
    this.soul = vocation.soulMax;
    if (options.kitItems !== undefined && options.kitItems.length > 0) {
      const kit: VocationPieceResult[] = [];
      for (const { item } of options.kitItems) {
        kit.push({ itemId: item.id, status: this.#grantKitPiece(item, options) });
      }
      return { ok: true, weapon: 'none', kit };
    }
    if (weapon === null) return { ok: true, weapon: 'none' };

    const carried: CarriedItem = {
      instanceId: options.instanceId,
      itemId: weapon.id,
      quantity: 1,
      origin: 'vocation-choice',
    };
    // `forceAdd` ignora peso (ADR 0048 decisão 7): sem capacidade nunca é motivo para recusar
    // a arma da vocação. Só falta catálogo ou pilha grande demais — nenhum dos dois acontece
    // aqui, porque quem monta `weapon` já leu do mesmo catálogo.
    this.inventory.forceAdd(carried, options.catalog, options.rules);
    // `equip` troca com o que está na mão: a machete volta para a mochila sozinha.
    const equipped = this.inventory.equip(carried.instanceId, this, options.catalog);
    return { ok: true, weapon: equipped.ok ? 'equipped' : 'in-backpack' };
  }

  /**
   * Uma peça do kit (#496): entra pelo peso ignorado (`forceAdd`, ADR 0048 decisão 7), veste
   * pelo slot do item (`equip`), e o que não veste fica em segurança onde já está. Nem o lugar
   * nem o peso recusam kit — só o slot (duas mãos) decide entre vestir e ficar na mochila.
   */
  #grantKitPiece(item: Item, options: VocationChoiceOptions): VocationPieceStatus {
    const carried: CarriedItem = {
      instanceId: `${options.instanceId}:${item.id}`,
      itemId: item.id,
      quantity: 1,
      origin: 'vocation-choice',
    };
    this.inventory.forceAdd(carried, options.catalog, options.rules);
    // `equip` troca com o que está no slot: a machete volta para a mochila sozinha. A peça
    // impedida pelas duas mãos (o escudo com o bow vestido) fica na mochila, onde já está.
    const equipped = this.inventory.equip(carried.instanceId, this, options.catalog);
    return equipped.ok ? 'equipped' : 'in-backpack';
  }

  /**
   * Promove a vocação escolhida (#566, ADR 0042 decisão 1). `vocation` é a do PRÓPRIO
   * personagem (`this.vocationId`) — quem resolve isso é o chamador (`host.ts`, como em
   * `chooseVocation`). `vocation.promotion` ausente é `not-promotable` (conteúdo de teste sem
   * o bloco). `nowGold` é o saldo DISPONÍVEL — `gold + goldDelta` —, porque um gasto anterior
   * na mesma sessão de Cidade já baixou o que sobra para promover.
   *
   * O preço sai por `goldDelta`, liquidado pelo MESMO canal que já debita venda de item
   * (`#saveDurableReceipt`/`applyProgression` do `server`) — nenhum ledger novo (invariante 10).
   */
  promote(vocation: Vocation, nowGold: number): PromoteResult {
    if (this.vocationId === null) return { ok: false, reason: 'no-vocation' };
    if (this.promoted) return { ok: false, reason: 'already-promoted' };
    const promotion = vocation.promotion;
    if (promotion === undefined) return { ok: false, reason: 'not-promotable' };
    if (this.level < promotion.minLevel) return { ok: false, reason: 'level-too-low' };
    if (nowGold < promotion.price) return { ok: false, reason: 'insufficient-gold' };
    this.promoted = true;
    this.goldDelta -= promotion.price;
    return { ok: true };
  }

  /**
   * Escolhe a postura de luta (M30-03, #550) — o `Player::setFightMode` do Canary, sem o
   * `sendStats`/`sendSkills` (apresentação, do host). Devolve se o modo MUDOU: quem chama só
   * marca o personagem como sujo e reenvia os stats quando mudou, e escolher o modo em que já
   * está é um pedido válido que não escreve nada.
   */
  setFightMode(mode: FightMode): boolean {
    if (this.fightMode === mode) return false;
    this.fightMode = mode;
    return true;
  }

  getState(): CharacterState {
    return {
      id: this.id,
      position: this.position,
      health: this.health,
      maxHealth: this.maxHealth,
      mana: this.mana,
      maxMana: this.maxMana,
      level: this.level,
      xp: this.xp,
      soul: this.soul,
      vocationId: this.vocationId,
      ...(this.boostedMonsterId === undefined ? {} : { boostedMonsterId: this.boostedMonsterId }),
      staminaMs: this.staminaMs,
      staminaUpdatedAtMs: this.staminaUpdatedAtMs,
      speed: this.speed,
      gold: this.gold,
      goldDelta: this.goldDelta,
      alive: this.alive,
      skills: this.skills.getState(),
      bestiary: this.bestiary.getState(),
      charms: this.charms.getState(),
      capacity: this.capacity,
      inventory: this.inventory.getState(),
      lootSeq: this.lootSeq,
      ...(this.removedInstances.length === 0 ? {} : { removedInstances: this.removedInstances }),
      contribution: this.contribution.getState(),
      ...(this.ammo.size === 0 ? {} : { ammo: Object.fromEntries(this.ammo) }),
      // supplyStock/ammunitionStock NÃO seguem o mesmo `size === 0` do ammo: ammo só cresce
      // dentro de uma sessão (`selectAmmo` nunca remove uma família escolhida), então vazio ali
      // sempre quer dizer "nunca escolheu nada". O estoque de loot, ao contrário, É consumido
      // (`spendStock`/`#strike` fazem `Map.delete`) — drenar até zero DENTRO da sessão é um
      // resultado real, não "nunca teve". Omitir a chave aqui faria essa drenagem desaparecer no
      // snapshot que `#creditUnrestorable` lê (achado da revisão da #536): sempre incluir, e
      // deixar quem grava o extrato decidir se um objeto vazio é "drenado" ou "nunca tocado".
      supplyStock: Object.fromEntries(this.supplyStock),
      ammunitionStock: Object.fromEntries(this.ammunitionStock),
      // Como `supplyStock`: NÃO gatear por `size === 0`. Um storage setado e depois apagado
      // NESTA sessão (`setStorageValue(key, -1)`) é um resultado real — "voltou a não estar
      // setado" —, e omitir a chave faria o extrato não tocar a linha e o valor antigo
      // ressuscitar no próximo login (a mesma lição da revisão do #536).
      storages: Object.fromEntries(this.storages),
      cooldowns: this.cooldowns.getState(),
      direction: this.direction,
      ...(this.conditions.size === 0 ? {} : { conditions: this.conditions.getState() }),
      // Como `conditions`: omitido quando ainda vale `FULL_BLOCK_CHARGE` (nunca bloqueou), para
      // não inflar todo snapshot existente com dois zeros que o construtor já repõe sozinho.
      ...(isFullBlockCharge(this.blockCharge) ? {} : { blockCharge: this.blockCharge }),
      // O mesmo padrão: omitido enquanto ainda é o inicial (v1/v2 nunca o tocam).
      ...(isInitialAttackPractice(this.attackPractice)
        ? {} : { attackPractice: this.attackPractice }),
      // Mesmo padrão: omitido em zero, o de quem nunca comeu/nunca consumiu carga (#726).
      ...(this.fedMs === 0 ? {} : { fedMs: this.fedMs }),
      ...(this.blessings === 0 ? {} : { blessings: this.blessings }),
      ...(this.pendingManualAction === null ? {} : { pendingManualAction: this.pendingManualAction }),
      ...(this.attackLockedUntil === 0 ? {} : { attackLockedUntil: this.attackLockedUntil }),
      ...(this.lastCombatActionAtMs === null
        ? {} : { lastCombatActionAtMs: this.lastCombatActionAtMs }),
      ...(this.promoted ? { promoted: true } : {}),
      // Omitidos no default (ofensiva, nunca bateu): o construtor os repõe sozinho.
      ...(this.fightMode === DEFAULT_FIGHT_MODE ? {} : { fightMode: this.fightMode }),
      ...(this.lastAttackAtMs === null ? {} : { lastAttackAtMs: this.lastAttackAtMs }),
    };
  }

  /**
   * Aplica dano à VIDA e devolve quanto saiu. Morrer é decisão do ruleset.
   *
   * Desde o CMB-08 a mana shield NÃO mora mais aqui: ela é um estágio explícito de
   * `applyDamageOutcome` (`combat/outcome.ts`), que descreve quanto absorveu antes de chamar
   * este método — e é lá que a condição `mana-shield` e o Energy Ring (SV-16) convergem numa
   * leitura OU-lógica só, sem debitar a mana duas vezes. O personagem guarda só a parte de vida,
   * como o monstro — a divisão de recurso é de quem aplica, e é o que permite testar absorção
   * total e parcial.
   */
  receiveDamage(amount: number): number {
    const applied = Math.min(amount, this.health);
    this.health -= applied;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return applied;
  }

  heal(amount: number): number {
    const applied = Math.min(amount, this.maxHealth - this.health);
    this.health += applied;
    return applied;
  }

  /**
   * Ganha alma (#593), capada no `soulMax` da vocação. Devolve o quanto de fato entrou — como
   * `heal` devolve o quanto de fato curou —, para quem chama saber se vale a pena continuar
   * tiquetando (o Canary não cancela a condição ao encher, mas o chamador pode).
   */
  gainSoul(amount: number, max: number): number {
    const applied = Math.min(amount, Math.max(0, max - this.soul));
    this.soul += applied;
    return applied;
  }
}
