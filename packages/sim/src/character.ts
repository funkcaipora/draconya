// Estado quente do personagem. A sessão dona é o único objeto que escreve aqui
// (invariante 9) — é também o que dispensa lock sobre o gold.

import type { AmmoFamily, Ammunition, Item, Vocation } from '@draconya/content';
import type { Direction } from './area.js';
import { FULL_BLOCK_CHARGE } from './combat/block-charge.js';
import type { BlockChargeState } from './combat/block-charge.js';
import { Bestiary } from './bestiary.js';
import type { BestiaryState } from './bestiary.js';
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
   * A vocação escolhida, ou ausente enquanto não há uma — o personagem nasce sem e escolhe no
   * level 8 (§7.4).
   *
   * Opcional, e não `string | null` obrigatório, porque snapshot gravado antes da FUN-37 não
   * tem a chave. Ausente e `null` querem dizer a mesma coisa aqui — "sem vocação" —, então o
   * formato antigo continua legível e o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
   */
  readonly vocationId?: string | null;
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
   * O que caiu e NÃO coube na mochila (§21.6, FUN-88).
   *
   * Fica aqui, e não fora da sessão, porque o `sim` não faz I/O (invariante 1): a caixa de
   * verdade é escrita quando a sessão encerra. Entra no snapshot para uma queda de nó não
   * apagar o que o jogador ganhou — e o custo é uma lista quase sempre vazia.
   */
  readonly lootBox?: readonly CarriedItem[];
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
}

/** Por que a munição não foi escolhida. Tipada: o jogador merece saber qual foi. */
export type AmmoRefusal = 'level-too-low';
export type AmmoResult = { readonly ok: true } | { readonly ok: false; readonly reason: AmmoRefusal };

/** Por que a vocação não foi escolhida (#154). Tipada: o jogador merece saber qual foi. */
export type VocationRefusal = 'level-too-low' | 'already-chosen';

/**
 * Como uma peça do kit inicial acabou (#496). `equipped` vestiu; `in-backpack` coube no
 * inventário mas não vestiu — o escudo do Paladin, impedido pelo bow de duas mãos; `in-loot-box`
 * não coube nem em peso.
 */
export type VocationPieceStatus = 'equipped' | 'in-backpack' | 'in-loot-box';

export interface VocationPieceResult {
  readonly itemId: string;
  readonly status: VocationPieceStatus;
}

export type VocationResult =
  | {
      readonly ok: true;
      readonly weapon: 'equipped' | 'in-backpack' | 'in-loot-box' | 'none';
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
  vocationId: string | null;
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
  capacity: number;
  /** Mutado ao equipar e ao receber item. Só a sessão dona escreve (invariante 9). */
  readonly inventory: Inventory;
  /** O que caiu e não coube. Ver `CharacterState.lootBox`. */
  lootBox: CarriedItem[];
  lootSeq: number;
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

  constructor(state: CharacterState) {
    this.id = state.id;
    this.position = state.position;
    this.health = state.health;
    this.maxHealth = state.maxHealth;
    this.mana = state.mana;
    this.maxMana = state.maxMana;
    this.level = state.level;
    this.xp = state.xp;
    this.vocationId = state.vocationId ?? null;
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
    this.capacity = state.capacity ?? 0;
    this.inventory = Inventory.fromState(state.inventory);
    this.lootBox = [...(state.lootBox ?? [])];
    this.lootSeq = state.lootSeq ?? 0;
    this.contribution = Contribution.fromState(state.contribution);
    this.ammo = new Map(Object.entries(state.ammo ?? {}) as [AmmoFamily, string][]);
    this.supplyStock = new Map(Object.entries(state.supplyStock ?? {}));
    this.ammunitionStock = new Map(Object.entries(state.ammunitionStock ?? {}));
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
    this.direction = state.direction ?? 'south';
    this.conditions = Conditions.fromState(state.conditions);
    this.blockCharge = state.blockCharge ?? FULL_BLOCK_CHARGE;
  }

  /** Haste (#155): o multiplicador que `movementDuration` lê. `speed` continua sendo a base da tabela. */
  get speedScale(): number {
    return this.conditions.speedScale();
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
   * Escolhe a vocação (#154, ADR 0026 decisão 1) — uma vez, no level da escolha ou depois.
   *
   * Os itens entram pelos caminhos que já existem: `add` (peso) e `equip` (vocação, level, duas
   * mãos). A escolha vale MESMO que um item não vista: sem capacidade ele vai para a Caixa de
   * Loot, com escudo vestido e bow ele fica na mochila — perder a vocação por causa de peso
   * seria punir a decisão pela mochila. `retarget` NÃO é chamado: a tabela da vocação vale do
   * próximo level em diante (`progression.ts`), e o ruleset já lê `vocationId` a cada level up.
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
    if (!this.inventory.add(carried, options.catalog, this, options.rules).ok) {
      this.lootBox.push(carried);
      return { ok: true, weapon: 'in-loot-box' };
    }
    // `equip` troca com o que está na mão: a machete volta para a mochila sozinha.
    const equipped = this.inventory.equip(carried.instanceId, this, options.catalog);
    return { ok: true, weapon: equipped.ok ? 'equipped' : 'in-backpack' };
  }

  /**
   * Uma peça do kit (#496): entra pelo peso (`add`), veste pelo slot do item (`equip`), e o que
   * não veste fica em segurança onde já está. O lugar da mochila NUNCA recusa kit — só o peso
   * recusa, e a Caixa segura.
   */
  #grantKitPiece(item: Item, options: VocationChoiceOptions): VocationPieceStatus {
    const carried: CarriedItem = {
      instanceId: `${options.instanceId}:${item.id}`,
      itemId: item.id,
      quantity: 1,
      origin: 'vocation-choice',
    };
    if (!this.inventory.add(carried, options.catalog, this, options.rules).ok) {
      this.lootBox.push(carried);
      return 'in-loot-box';
    }
    // `equip` troca com o que está no slot: a machete volta para a mochila sozinha. A peça
    // impedida pelas duas mãos (o escudo com o bow vestido) fica na mochila, onde já está.
    const equipped = this.inventory.equip(carried.instanceId, this, options.catalog);
    return equipped.ok ? 'equipped' : 'in-backpack';
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
      vocationId: this.vocationId,
      staminaMs: this.staminaMs,
      staminaUpdatedAtMs: this.staminaUpdatedAtMs,
      speed: this.speed,
      gold: this.gold,
      goldDelta: this.goldDelta,
      alive: this.alive,
      skills: this.skills.getState(),
      bestiary: this.bestiary.getState(),
      capacity: this.capacity,
      inventory: this.inventory.getState(),
      lootBox: this.lootBox,
      lootSeq: this.lootSeq,
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
      cooldowns: this.cooldowns.getState(),
      direction: this.direction,
      ...(this.conditions.size === 0 ? {} : { conditions: this.conditions.getState() }),
      // Como `conditions`: omitido quando ainda vale `FULL_BLOCK_CHARGE` (nunca bloqueou), para
      // não inflar todo snapshot existente com dois zeros que o construtor já repõe sozinho.
      ...(this.blockCharge[0] === 0 && this.blockCharge[1] === 0
        ? {} : { blockCharge: this.blockCharge }),
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
}
