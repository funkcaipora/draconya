// Mochila, bolsa, equipamento e capacidade (§21.4, §21.5, FUN-82, #160).
//
// **O que o personagem carrega é ESTADO QUENTE**, escrito só pela sessão dona (invariante 9), e
// o que vira linha no Postgres sai pelo extrato — como XP, gold e skill. Nada aqui escreve
// `item_instance`; a sessão registra onde as coisas estão e o `jobs` aplica.
//
// **Peso é o teto; lugar é posição.** O paradigma continua o do Tibia (§21.5): a mochila cabe
// o que a capacidade do personagem aguenta, e capacidade cresce com level. Desde #160 (ADR 0026
// decisão 6, o modelo do Huntera) o item tem LUGAR — a mochila é um vetor posicional de 20
// lugares (o item nas costas), a bolsa é um vetor fixo do personagem de 10, e os dois crescem
// por linhas, sem limite, enquanto houver capacidade. O lugar nunca recusa loot — o bot não
// pode parar de caçar por mochila cheia (invariante 11) —, só o peso recusa, e aí a Caixa de
// Loot segura.
//
// **`Inventory` não conhece conteúdo.** Os tamanhos iniciais e a linha chegam como números
// (`ContainerRules`) de quem tem a tabela — o ruleset em `onEnter`, o host no `move` —, porque
// `CharacterRuntime` constrói o inventário sem conteúdo nenhum.
//
// **Item no chão não existe** (§21.5). O que existe é o que está nos containers, o que está
// equipado, e o que está na Caixa de Loot da Sessão. Sem `stackpos`, sem cadáver como
// container, sem item largado — o §26 do documento de referência lista isso como rejeição
// deliberada, e é o que dispensa metade do modelo de mundo de uma engine de MMO.

import { DAMAGE_TYPES, matchesVocationRequirement } from '@draconya/content';
import type {
  CompiledMitigation, CompiledReflect, DamageModifiers, DamageType, Item, ItemOrigin, ItemSlot,
  Progression, RingEffect, SpecializedMagicElement, SuppressibleCondition,
} from '@draconya/content';
import type { SpecializedMagicLevels } from './casting.js';
import { NO_DEFENSE } from './combat/defense.js';
import type { DefenseSource } from './combat/defense.js';
import { hasItemOverlay, normalizeItemOverlay } from './item-overlay.js';
import type { ItemInstanceOverlay } from './item-overlay.js';
import type { DefenderAbsorb } from './combat/damage.js';

/**
 * A ordem em que o Canary varre os slots vestidos (`CONST_SLOT_FIRST..CONST_SLOT_LAST`: head,
 * necklace, backpack, armor, right, left, legs, feet, ring, ammo) — a de `Player::blockHit`
 * (#552). Importa porque a absorção percentual arredonda item a item: a ordem muda o número.
 */
const CANARY_SLOT_ORDER: readonly ItemSlot[] = [
  'head', 'neck', 'back', 'chest', 'hand', 'shield', 'legs', 'feet', 'finger', 'ammo',
];

/** Teto de empilhamento (§21.5). Item empilhável enche até aqui; espada não empilha. */
export const MAX_STACK = 100;

/** Um item carregado. `instanceId` é a IDENTIDADE — a linha de `item_instance` (FUN-76). */
export interface CarriedItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  /**
   * De onde veio (§25.3, #154). Ausente é `'loot'` — o snapshot anterior a #154 não tem a
   * chave, e tudo o que existia antes caiu de monstro. É o `origin` da linha de `item_instance`.
   *
   * Alargado de `'loot' | 'vocation-choice'` para `ItemOrigin` no #419: o comércio entrou como
   * `'market'` (`schemas.ts`), e o supply é abstrato — o gold sai no uso, sem pilha comprada.
   */
  readonly origin?: ItemOrigin;
  /**
   * Cargas RESTANTES (ADR 0032 d.8). Ausente é "cheio": a definição traz o total
   * (`Item.charges`) e o primeiro consumo materializa o número. Opcional, então nenhum
   * snapshot antigo precisa de bump. Só o colar usa hoje.
   */
  readonly charges?: number;
  /**
   * O estado por INSTÂNCIA (ADR 0046, #604): imbuements hoje; o prazo restante do anel (#689) e
   * o tier da Forja (#617) entram como campos nomeados do mesmo objeto — ver `item-overlay.ts`.
   * Ausente é "igual à definição", e é o caso de quase todo item. Opcional, então nenhum
   * snapshot antigo precisa de bump. Item com overlay NÃO empilha (ADR 0046 d.3).
   */
  readonly overlay?: ItemInstanceOverlay;
}

/**
 * Quem quer saber que o equipamento mudou. O `sim` o instala (o ruleset, na entrada); a Cidade
 * não tem. É o único lugar que agenda e cancela o vencimento de um item por duração, e é o que
 * mantém o vencimento FORA do tick (invariante 2, ADR 0020).
 */
export interface EquipmentObserver {
  onEquip(slot: ItemSlot, item: CarriedItem): void;
  onUnequip(slot: ItemSlot, item: CarriedItem): void;
}

/**
 * O equipamento mudou por decisão do próprio `sim` (ADR 0032 d.8): o colar esgotou ou o anel
 * venceu. O `server` o mapeia para a mensagem `inventory` já existente — nenhum opcode novo
 * (invariante 5).
 */
export interface EquipmentChanged {
  readonly kind: 'equipment-changed';
  readonly characterId: string;
}

export type ContainerName = 'backpack' | 'satchel';

/** Um lugar do inventário: posição num container, ou um slot do corpo. */
export type Place =
  | { readonly container: ContainerName; readonly index: number }
  | { readonly slot: ItemSlot };

/** Os números de conteúdo que o inventário não conhece: quem chama passa (ruleset e host). */
export interface ContainerRules {
  /** Lugares iniciais da mochila — `initialSlots` do item em `back`, ou 0 sem mochila. */
  readonly backpackSlots: number;
  /** Lugares iniciais da bolsa — `progression.satchelInitialSlots`. */
  readonly satchelSlots: number;
  /** Quantos lugares uma linha acrescenta quando o container enche. */
  readonly row: number;
}

export interface InventoryState {
  /**
   * v2 (#160): posicional, `null` é lugar vazio, o comprimento é o tamanho ATUAL. O v1 — lista
   * sem `null` e sem `satchel` — é aceito na leitura: os itens ocupam a mochila em ordem.
   */
  readonly backpack: readonly (CarriedItem | null)[];
  readonly satchel?: readonly (CarriedItem | null)[];
  /** Slot → o item vestido. O item equipado NÃO está nos containers; ele está no corpo. */
  readonly equipped: Readonly<Partial<Record<ItemSlot, CarriedItem>>>;
}

/** Por que um item não entrou, não foi equipado, ou não se moveu. Tipada: o jogador merece saber qual foi. */
export type InventoryRefusal =
  | 'over-capacity'
  | 'not-carried'
  | 'not-equippable'
  | 'level-too-low'
  | 'wrong-vocation'
  | 'stack-too-large'
  /** Arma de duas mãos com escudo vestido, ou escudo com arma de duas mãos na mão (#152). */
  | 'hands-full'
  /** Desvestir a mochila com item dentro (#160): ela só sai vazia. */
  | 'backpack-not-empty'
  /** Um lugar que não existe — índice fora do vetor (#160). */
  | 'no-such-place'
  /** Mover a partir de um lugar vazio (#160). */
  | 'empty-place';

export type InventoryResult = { readonly ok: true } | {
  readonly ok: false; readonly reason: InventoryRefusal;
};

const OK: InventoryResult = { ok: true };

/** O que a regra de equipar precisa saber de quem equipa. Nada além disto. */
export interface Wearer {
  readonly level: number;
  readonly vocationId: string | null;
  /** Quanto ele aguenta carregar, em unidades de peso. Vem da tabela de progressão. */
  readonly capacity: number;
}

/** O que `requires` de um item confere: level e vocação. É o que `weapon()` lê do portador. */
export type Requirements = Pick<Wearer, 'level' | 'vocationId'>;

/**
 * A arma na mão e a porcentagem do golpe (#687): `100` no level, `50` abaixo dele com
 * `wieldUnproperly`, `0` abaixo dele sem — o `damageModifier` do `playerWeaponCheck` do Canary.
 */
export interface HeldWeapon {
  readonly item: Item;
  readonly damagePercent: 100 | 50 | 0;
}

export class Inventory {
  #backpack: (CarriedItem | null)[] = [];
  #satchel: (CarriedItem | null)[] = [];
  readonly #equipped = new Map<ItemSlot, CarriedItem>();
  /** Os tamanhos iniciais, para aparar linhas vazias do fim (`remove`). Zero até `ensureContainers`. */
  #initial = { backpack: 0, satchel: 0 };
  /**
   * Quem observa o equipamento (ADR 0032 d.8). Instalado pelo ruleset em `onEnter`/`onResume`,
   * limpo em `onLeave`/`onEnd`: uma closure apontando para uma sessão morta vazaria. `null` é a
   * Cidade e todo estado antes de o ruleset existir.
   */
  #observer: EquipmentObserver | null = null;

  static fromState(state: InventoryState | undefined): Inventory {
    const inventory = new Inventory();
    if (state === undefined) return inventory;
    // v1 → v2 na leitura: lista sem `null` e sem `satchel` vira os primeiros lugares da
    // mochila. Sem bump de `SNAPSHOT_FORMAT_VERSION`: o formato antigo é reconhecível.
    inventory.#backpack = [...state.backpack];
    inventory.#satchel = [...(state.satchel ?? [])];
    for (const [slot, item] of Object.entries(state.equipped)) {
      if (item !== undefined) inventory.#equipped.set(slot as ItemSlot, item);
    }
    inventory.#initial = { backpack: inventory.#backpack.length, satchel: inventory.#satchel.length };
    return inventory;
  }

  getState(): InventoryState {
    return {
      backpack: [...this.#backpack],
      satchel: [...this.#satchel],
      equipped: Object.fromEntries(this.#equipped) as InventoryState['equipped'],
    };
  }

  /**
   * Garante os tamanhos iniciais (#160). Idempotente, e nunca ENCOLHE: chamada em `onEnter`,
   * que é onde o conteúdo existe — é o mesmo lugar em que `speed` e `capacity` são repostos
   * pela tabela. Também é o que migra um snapshot v1: os itens já estão nos primeiros lugares,
   * e aqui o vetor ganha o resto dos 20.
   */
  ensureContainers(rules: ContainerRules): void {
    this.#initial = {
      backpack: Math.max(this.#initial.backpack, rules.backpackSlots),
      satchel: Math.max(this.#initial.satchel, rules.satchelSlots),
    };
    while (this.#backpack.length < rules.backpackSlots) this.#backpack.push(null);
    while (this.#satchel.length < rules.satchelSlots) this.#satchel.push(null);
  }

  get backpack(): readonly (CarriedItem | null)[] {
    return this.#backpack;
  }

  get satchel(): readonly (CarriedItem | null)[] {
    return this.#satchel;
  }

  /** Tudo o que está nos containers (sem `null`), mochila primeiro. */
  *items(): IterableIterator<CarriedItem> {
    for (const item of this.#backpack) if (item !== null) yield item;
    for (const item of this.#satchel) if (item !== null) yield item;
  }

  equippedAt(slot: ItemSlot): CarriedItem | null {
    return this.#equipped.get(slot) ?? null;
  }

  /** Instalado pelo ruleset em `onEnter`/`onResume`; limpo em `onLeave`/`onEnd`. */
  setEquipmentObserver(observer: EquipmentObserver | null): void {
    this.#observer = observer;
  }

  /**
   * Gasta UMA carga do item equipado no slot e devolve o que sobrou; `0` é destruído (ADR 0032
   * d.8). `full` é o total da definição — é o valor de um `charges` ainda ausente, então o
   * primeiro consumo materializa o número sem inicializar nada no equip.
   *
   * Em zero o item SAI do corpo e não vai para container: carga esgotada destrói (§24), e
   * devolver à mochila daria uma segunda vida a ele.
   */
  consumeCharge(slot: ItemSlot, full: number): number {
    const equipped = this.#equipped.get(slot);
    if (equipped === undefined) return 0;
    const left = (equipped.charges ?? full) - 1;
    if (left <= 0) {
      this.#equipped.delete(slot);
      this.#observer?.onUnequip(slot, equipped);
      return 0;
    }
    this.#equipped.set(slot, { ...equipped, charges: left });
    return left;
  }

  /** Some com o item do slot sem passar por container (esgotou). Devolve o que saiu. */
  destroy(slot: ItemSlot): CarriedItem | null {
    const equipped = this.#equipped.get(slot);
    if (equipped === undefined) return null;
    this.#equipped.delete(slot);
    this.#observer?.onUnequip(slot, equipped);
    return equipped;
  }

  /**
   * Regrava o overlay da instância ONDE ELA ESTIVER — container ou corpo —, sem mudar lugar,
   * peso nem chamar o observer (ADR 0046 d.2). `undefined` (ou um overlay vazio) tira o
   * overlay, e a peça volta a ser igual à definição. Devolve `false` se a instância não está
   * com ele.
   *
   * É o único escritor do overlay dentro do `sim`: aplicar imbuement (#607), decair (#606), o
   * prazo do anel (#689) e o tier (#617) passam por aqui, cada um mexendo no SEU campo —
   * `{ ...item.overlay, campo }` —, e nunca apagando o dos outros.
   */
  setOverlay(instanceId: string, overlay: ItemInstanceOverlay | undefined): boolean {
    const normalized = normalizeItemOverlay(overlay);
    const apply = (item: CarriedItem): CarriedItem => {
      const { overlay: _previous, ...rest } = item;
      return normalized === undefined ? rest : { ...rest, overlay: normalized };
    };
    const place = this.#placeOf(instanceId);
    if (place !== null) {
      this.#set(place, apply(this.#at(place) as CarriedItem));
      return true;
    }
    for (const [slot, item] of this.#equipped) {
      if (item.instanceId !== instanceId) continue;
      this.#equipped.set(slot, apply(item));
      return true;
    }
    return false;
  }

  /**
   * O peso do que ele carrega — containers MAIS equipado.
   *
   * Equipado conta: uma armadura vestida não fica mais leve por estar no corpo, e a alternativa
   * seria o jogador equipar tudo para carregar o dobro.
   */
  weight(catalog: ReadonlyMap<string, Item>): number {
    let total = 0;
    for (const item of this.items()) total += weightOf(catalog, item);
    for (const item of this.#equipped.values()) total += weightOf(catalog, item);
    return total;
  }

  /**
   * Põe num container, se o PESO couber: pilha → primeiro lugar livre → uma linha a mais.
   *
   * Sem mochila nas costas o loot vai para a bolsa (ADR 0026 d.6): a bolsa é do personagem.
   * Recusa só por peso: o item que não cabe vai para a Caixa de Loot da Sessão (§21.5), e
   * quem chama decide o que fazer com `over-capacity`. O lugar nunca recusa — o bot não pode
   * parar de caçar por mochila cheia.
   */
  add(
    item: CarriedItem, catalog: ReadonlyMap<string, Item>, wearer: Wearer, rules: ContainerRules,
  ): InventoryResult {
    const definition = catalog.get(item.itemId);
    if (definition === undefined) return { ok: false, reason: 'not-carried' };
    if (item.quantity > MAX_STACK) return { ok: false, reason: 'stack-too-large' };

    const added = definition.weight * item.quantity;
    if (this.weight(catalog) + added > wearer.capacity) {
      return { ok: false, reason: 'over-capacity' };
    }

    const target = this.#equipped.has('back') ? this.#backpack : this.#satchel;
    // Empilhável junta na pilha existente, até o teto. Não empilhável vira lugar novo, sempre:
    // duas espadas são duas identidades, e é essa identidade que carrega a proveniência.
    // Item com overlay (ADR 0046 d.3) não é fungível: nem entra numa pilha, nem recebe uma.
    if (definition.stackable && !hasItemOverlay(item)) {
      const index = target.findIndex(
        (carried) => carried !== null && carried.itemId === item.itemId
          && !hasItemOverlay(carried)
          && carried.quantity + item.quantity <= MAX_STACK,
      );
      const existing = target[index];
      if (existing !== undefined && existing !== null) {
        target[index] = { ...existing, quantity: existing.quantity + item.quantity };
        return OK;
      }
    }
    target[this.#freePlace(target, rules)] = item;
    return OK;
  }

  /** O primeiro lugar livre, abrindo uma linha se não há nenhum. */
  #freePlace(target: (CarriedItem | null)[], rules: ContainerRules): number {
    const free = target.indexOf(null);
    if (free >= 0) return free;
    const at = target.length;
    for (let i = 0; i < Math.max(1, rules.row); i += 1) target.push(null);
    return at;
  }

  /** Tira do container e devolve o que saiu, ou `null` se não estava lá. Apara as linhas vazias do fim. */
  remove(instanceId: string): CarriedItem | null {
    for (const [target, initial] of [[this.#backpack, this.#initial.backpack], [this.#satchel, this.#initial.satchel]] as const) {
      const index = target.findIndex((carried) => carried?.instanceId === instanceId);
      if (index < 0) continue;
      const removed = target[index] as CarriedItem;
      target[index] = null;
      this.#trim(target, initial);
      return removed;
    }
    return null;
  }

  /** Apara `null` do fim, linha a linha, até o tamanho inicial — nunca abaixo dele. */
  #trim(target: (CarriedItem | null)[], initial: number): void {
    while (target.length > initial && target[target.length - 1] === null) target.pop();
  }

  /**
   * A primeira pilha deste item nos containers, ou `null`. Mochila primeiro — é a mesma ordem
   * de `items()` e a que o jogador vê.
   */
  findStack(itemId: string): CarriedItem | null {
    for (const item of this.items()) if (item.itemId === itemId) return item;
    return null;
  }

  /**
   * Veste o item, trocando pelo que já estava no slot (§21.4).
   *
   * As três recusas são as do §21.2: o item precisa ter slot, e o personagem precisa do level e
   * da vocação. Vocação é o mesmo campo que a magia usa (FUN-92) — e o personagem nasce sem
   * uma, então item de vocação é inacessível até o level 8 por construção.
   *
   * O que sai do corpo vai para o LUGAR de onde o novo saiu (#160): a troca não muda o peso e
   * não precisa de lugar novo.
   */
  equip(
    instanceId: string, wearer: Wearer, catalog: ReadonlyMap<string, Item>,
  ): InventoryResult {
    const from = this.#placeOf(instanceId);
    if (from === null) return { ok: false, reason: 'not-carried' };
    return this.#equipFrom(from, wearer, catalog);
  }

  #equipFrom(
    from: { readonly container: ContainerName; readonly index: number },
    wearer: Wearer, catalog: ReadonlyMap<string, Item>,
  ): InventoryResult {
    const carried = this.#at(from);
    if (carried === undefined || carried === null) return { ok: false, reason: 'not-carried' };
    const definition = catalog.get(carried.itemId);
    if (definition?.slot === undefined) return { ok: false, reason: 'not-equippable' };
    if (definition.requires.level !== undefined && wearer.level < definition.requires.level) {
      return { ok: false, reason: 'level-too-low' };
    }
    if (!matchesVocationRequirement(definition.requires.vocationId, wearer.vocationId)) {
      return { ok: false, reason: 'wrong-vocation' };
    }

    // As duas mãos (#152, ADR 0026): o bow ocupa também o escudo. Vestir um com o outro no
    // lugar é recusado, e não trocado — tirar o escudo por conta própria seria decidir pelo
    // jogador o que ele queria fora do corpo.
    if (definition.twoHanded && this.#equipped.has('shield')) {
      return { ok: false, reason: 'hands-full' };
    }
    if (definition.slot === 'shield') {
      const inHand = this.#equipped.get('hand');
      if (inHand !== undefined && catalog.get(inHand.itemId)?.twoHanded) {
        return { ok: false, reason: 'hands-full' };
      }
    }
    // Trocar de mochila (#160): a que sai precisa estar vazia — o que está dentro dela não
    // tem para onde ir.
    if (definition.slot === 'back' && this.#equipped.has('back') && this.#backpack.some((c) => c !== null)) {
      return { ok: false, reason: 'backpack-not-empty' };
    }

    const previous = this.#equipped.get(definition.slot) ?? null;
    this.#equipped.set(definition.slot, carried);
    // O que sai volta para o LUGAR do que entrou. Peso total inalterado, então não há como esta
    // troca estourar a capacidade — e por isso não há conferência aqui.
    this.#set(from, previous);
    if (previous === null) this.#trim(this.#containerOf(from.container), this.#initialOf(from.container));
    // Depois da transação concluída (ADR 0032 d.8): o observer cancela o prazo antigo do slot e
    // agenda o do item que entrou. Um item que saiu para outro do mesmo slot perde o prazo.
    this.#observer?.onEquip(definition.slot, carried);
    return OK;
  }

  /**
   * Tira do corpo para o primeiro lugar livre (#160): da mochila, ou da bolsa sem mochila.
   * Abre uma linha se preciso — desvestir não muda o peso, então não há recusa por
   * capacidade. A mochila só sai vazia.
   */
  unequip(slot: ItemSlot, rules: ContainerRules): InventoryResult {
    const equipped = this.#equipped.get(slot);
    if (equipped === undefined) return { ok: false, reason: 'not-carried' };
    if (slot === 'back' && this.#backpack.some((c) => c !== null)) {
      return { ok: false, reason: 'backpack-not-empty' };
    }
    this.#equipped.delete(slot);
    const target = this.#equipped.has('back') ? this.#backpack : this.#satchel;
    target[this.#freePlace(target, rules)] = equipped;
    this.#observer?.onUnequip(slot, equipped);
    return OK;
  }

  /**
   * Move um item entre dois lugares (#160): troca, empilha (até o teto — o resto fica na
   * origem), veste (`to` é slot) ou desveste para um lugar específico (`from` é slot).
   *
   * É uma TRANSAÇÃO (referência §25): tudo é validado antes de qualquer escrita, e a recusa
   * não muta nada. O peso total nunca muda ao mover, então não há conferência de capacidade.
   */
  move(
    from: Place, to: Place, catalog: ReadonlyMap<string, Item>, wearer: Wearer, rules: ContainerRules,
  ): InventoryResult {
    if ('slot' in from && 'slot' in to) return { ok: false, reason: 'not-equippable' };
    // Corpo → lugar: desvestir PARA um lugar (vazio, ou pilha compatível).
    if ('slot' in from) {
      const equipped = this.#equipped.get(from.slot);
      if (equipped === undefined) return { ok: false, reason: 'empty-place' };
      if (from.slot === 'back' && this.#backpack.some((c) => c !== null)) {
        return { ok: false, reason: 'backpack-not-empty' };
      }
      const destination = this.#at(to as { container: ContainerName; index: number });
      if (destination === undefined) return { ok: false, reason: 'no-such-place' };
      if (destination !== null) {
        // Só numa pilha compatível com espaço; senão o lugar está ocupado.
        const definition = catalog.get(equipped.itemId);
        if (!stacksWith(definition, equipped, destination)
          || destination.quantity + equipped.quantity > MAX_STACK) {
          return { ok: false, reason: 'no-such-place' };
        }
        this.#equipped.delete(from.slot);
        this.#set(to as { container: ContainerName; index: number }, { ...destination, quantity: destination.quantity + equipped.quantity });
        this.#observer?.onUnequip(from.slot, equipped);
        return OK;
      }
      this.#equipped.delete(from.slot);
      this.#set(to as { container: ContainerName; index: number }, equipped);
      this.#observer?.onUnequip(from.slot, equipped);
      return OK;
    }
    const source = this.#at(from);
    if (source === undefined) return { ok: false, reason: 'no-such-place' };
    if (source === null) return { ok: false, reason: 'empty-place' };
    // Lugar → corpo: é `equip` a partir daquele lugar, com o desequipado indo para `from`.
    if ('slot' in to) return this.#equipFrom(from, wearer, catalog);

    const destination = this.#at(to);
    if (destination === undefined) return { ok: false, reason: 'no-such-place' };
    if (from.container === to.container && from.index === to.index) return OK;
    const definition = catalog.get(source.itemId);
    if (destination !== null && stacksWith(definition, source, destination)) {
      // Empilha até o teto; o que não coube fica na origem. Peso total inalterado.
      const moved = Math.min(source.quantity, MAX_STACK - destination.quantity);
      if (moved > 0) {
        this.#set(to, { ...destination, quantity: destination.quantity + moved });
        this.#set(from, moved === source.quantity ? null : { ...source, quantity: source.quantity - moved });
        if (moved === source.quantity) this.#trim(this.#containerOf(from.container), this.#initialOf(from.container));
        return OK;
      }
    }
    // Troca (ou move para o vazio).
    this.#set(to, source);
    this.#set(from, destination);
    if (destination === null) this.#trim(this.#containerOf(from.container), this.#initialOf(from.container));
    return OK;
  }

  #containerOf(name: ContainerName): (CarriedItem | null)[] {
    return name === 'backpack' ? this.#backpack : this.#satchel;
  }

  #initialOf(name: ContainerName): number {
    return name === 'backpack' ? this.#initial.backpack : this.#initial.satchel;
  }

  /** O que está num lugar: `undefined` se o lugar não existe, `null` se está vazio. */
  #at(place: { readonly container: ContainerName; readonly index: number }): CarriedItem | null | undefined {
    const target = this.#containerOf(place.container);
    if (!Number.isInteger(place.index) || place.index < 0 || place.index >= target.length) return undefined;
    return target[place.index] ?? null;
  }

  #set(place: { readonly container: ContainerName; readonly index: number }, item: CarriedItem | null): void {
    this.#containerOf(place.container)[place.index] = item;
  }

  #placeOf(instanceId: string): { readonly container: ContainerName; readonly index: number } | null {
    for (const container of ['backpack', 'satchel'] as const) {
      const index = this.#containerOf(container).findIndex((c) => c?.instanceId === instanceId);
      if (index >= 0) return { container, index };
    }
    return null;
  }

  /**
   * O ataque da arma equipada, ou `null` quando ele está desarmado.
   *
   * `null` e não zero: desarmado tem ataque, e o número dele é conteúdo
   * (`combat.player.attackPower`). Devolver zero aqui faria o personagem sem arma não machucar
   * nada, e "sem arma" é o estado em que todo personagem começa.
   */
  weaponAttack(catalog: ReadonlyMap<string, Item>, wearer: Requirements): number | null {
    return this.weapon(catalog, wearer)?.attack ?? null;
  }

  /**
   * A DEFINIÇÃO da arma na mão, ou `null` desarmado (#152). É por ela que o ruleset decide
   * como bater — corpo a corpo, tiro com munição, ou wand — e a que alcance.
   *
   * Lida COM o portador: a arma que exige vocação ou level que ele não tem conta como mão
   * vazia. `equip` já recusa isso, mas o que está na mão não veio só de `equip` — um snapshot
   * anterior à regra, ou uma instância gravada por outro caminho, chegam por `fromState` sem
   * passar por ela. Conferir aqui, e não em cada leitor, é o que faz alcance, ataque e modo de
   * bater caírem juntos para o desarmado.
   */
  weapon(catalog: ReadonlyMap<string, Item>, wearer: Requirements): Item | null {
    const carried = this.#equipped.get('hand');
    if (carried === undefined) return null;
    const definition = catalog.get(carried.itemId);
    if (definition === undefined) return null;
    if (!this.#meets(definition, wearer)) return null;
    return definition;
  }

  /**
   * A arma na mão com o quanto ela bate (#687, só o `combat-v3` lê) — o `playerWeaponCheck` do
   * Canary. Irmã de `weapon()`, com UMA diferença: a arma vestida abaixo do level exigido não
   * vira mão vazia. O level cai com a arma na mão (penalidade de morte), e aí ela bate metade
   * com `wieldUnproperly` ou não bate (`0`: o chamador não emite golpe, nem de punho).
   *
   * Vocação errada continua mão vazia (`null`), como em `weapon()`: `equip` recusa, e o que
   * chega por `fromState` sem passar por ela não pode virar golpe.
   */
  heldWeapon(catalog: ReadonlyMap<string, Item>, wearer: Requirements): HeldWeapon | null {
    const carried = this.#equipped.get('hand');
    if (carried === undefined) return null;
    const item = catalog.get(carried.itemId);
    if (item === undefined) return null;
    if (!matchesVocationRequirement(item.requires.vocationId, wearer.vocationId)) return null;
    if (item.requires.level !== undefined && wearer.level < item.requires.level) {
      return { item, damagePercent: item.weapon?.wieldUnproperly === true ? 50 : 0 };
    }
    return { item, damagePercent: 100 };
  }

  /**
   * A DEFINIÇÃO do que está no slot de escudo (mão secundária), ou `null` sem nada lá (#549,
   * M30-02) — escudo, spellbook ou quiver, as três peças que só existem nesse slot. Irmã de
   * `weapon()`: mesma checagem de requisito, mesma leitura de "não veste" para snapshot antigo
   * ou instância fora de `equip`.
   */
  shield(catalog: ReadonlyMap<string, Item>, wearer: Requirements): Item | null {
    const carried = this.#equipped.get('shield');
    if (carried === undefined) return null;
    const definition = catalog.get(carried.itemId);
    if (definition === undefined) return null;
    if (!this.#meets(definition, wearer)) return null;
    return definition;
  }

  /**
   * A fonte de DEFESA do que está vestido (CMB-04, DT-01): escudo primeiro, depois a arma de
   * uma mão, e `none` quando não há nenhuma das duas.
   *
   * A escolha mora AQUI, e não no ruleset, porque é a mesma regra que já decide slots e
   * compatibilidades: o escudo só existe no slot `shield`, e a incompatibilidade bow/escudo é
   * recusada por `equip` — o ruleset não tem por que repetir nenhuma das duas.
   *
   * Escudo precede a arma (DT-02): somar as duas mãos seria stacking implícito, e o que o
   * jogador vê na mão é uma fonte só. Arma de duas mãos (bow) e wand/rod não dão defesa
   * residual — a primeira porque ocupa as duas mãos, a segunda porque não bloqueia.
   *
   * A peça que exige level ou vocação que o portador não tem conta como ausente, pela mesma
   * razão que `weapon()` a lê como mão vazia: um snapshot pode trazer o item sem `equip`.
   */
  defenseSource(catalog: ReadonlyMap<string, Item>, wearer: Requirements): DefenseSource {
    const shield = this.#equipped.get('shield');
    if (shield !== undefined) {
      const definition = catalog.get(shield.itemId);
      if (definition?.kind === 'shield' && this.#meets(definition, wearer)) {
        return { kind: 'shield', defense: definition.defense };
      }
    }
    const weapon = this.weapon(catalog, wearer);
    if (weapon !== null && !weapon.twoHanded && weapon.weapon?.kind === 'melee') {
      return { kind: 'weapon', defense: weapon.defense };
    }
    return NO_DEFENSE;
  }

  /** O level e a vocação que `requires` pede, conferidos numa regra só (arma e escudo). */
  #meets(definition: Item, wearer: Requirements): boolean {
    if (definition.requires.level !== undefined && wearer.level < definition.requires.level) {
      return false;
    }
    return matchesVocationRequirement(definition.requires.vocationId, wearer.vocationId);
  }

  /** A armadura somada do que está vestido. Zero é ninguém vestido, e é um número honesto. */
  armor(catalog: ReadonlyMap<string, Item>): number {
    let total = 0;
    for (const item of this.#equipped.values()) total += catalog.get(item.itemId)?.armor ?? 0;
    return total;
  }

  /**
   * A resistência/vulnerabilidade e as imunidades do EQUIPAMENTO (CMB-03).
   *
   * Soma a resistência por tipo (como a armadura soma) e UNE as imunidades: qualquer peça que
   * imuniza imuniza o portador. São poucos slots, então o custo por golpe é limitado e não
   * depende do catálogo — nenhuma varredura de tabela de resistência.
   *
   * O item guarda o perfil já COMPILADO no boot (`Item.mitigation`), então aqui só há lookup.
   */
  mitigation(catalog: ReadonlyMap<string, Item>): CompiledMitigation {
    // Fast path: sem NENHUMA peça com mitigação, o defensor é neutro e não há o que alocar no
    // caminho quente. É o caso de todo o conteúdo v1, em que nenhum item resiste a nada.
    let contributing = false;
    for (const carried of this.#equipped.values()) {
      const item = catalog.get(carried.itemId);
      if (item === undefined) continue;
      if (item.mitigation.immunities.size > 0
        || DAMAGE_TYPES.some((type) => item.mitigation.resistances[type] !== 0)) {
        contributing = true;
        break;
      }
    }
    if (!contributing) return NEUTRAL_MITIGATION;

    const resistances: Record<DamageType, number> = {
      physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
      drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
    };
    const immunities = new Set<DamageType>();
    for (const carried of this.#equipped.values()) {
      const item = catalog.get(carried.itemId);
      if (item === undefined) continue;
      for (const type of DAMAGE_TYPES) resistances[type] += item.mitigation.resistances[type];
      for (const type of item.mitigation.immunities) immunities.add(type);
    }
    return { resistances, immunities };
  }

  /**
   * O efeito do anel no dedo, pelo catálogo — `null` sem anel equipado, ou com um item sem
   * `ringEffect` (§13.9, SV-16). Molde de `armor()`: `Inventory` não conhece conteúdo, então quem
   * chama (o ruleset) é quem tem o catálogo.
   */
  ringEffect(catalog: ReadonlyMap<string, Item>): RingEffect | null {
    const ring = this.equippedAt('finger');
    if (ring === null) return null;
    return catalog.get(ring.itemId)?.ringEffect ?? null;
  }

  /**
   * O bônus de UMA skill do que está vestido, somado (#524, #688): o Hat of the Mad soma na
   * `magic` (que aqui É o magic level, FUN-92), a Paladin Armor na `distance`, e um item com
   * várias skills soma em cada uma delas — o laço de `setVarSkill` do Canary. Molde de `armor()`:
   * uma varredura dos poucos slots equipados, não uma tabela por skill — o custo por leitura é
   * limitado e não depende do catálogo. O boot garante uma entrada por skill por item.
   */
  skillBonus(catalog: ReadonlyMap<string, Item>, skillId: string): number {
    let total = 0;
    for (const carried of this.#equipped.values()) {
      for (const bonus of catalog.get(carried.itemId)?.bonuses?.skills ?? []) {
        if (bonus.skillId === skillId) total += bonus.amount;
      }
    }
    return total;
  }

  /**
   * Se algo vestido suprime `condition` (#688, `suppress*` do Canary): o Dwarven Ring suprime
   * `drunk`. Como `Creature::addCondition`/`hasCondition` do Canary, quem consulta isto recusa a
   * condição nova e ignora a que já estava ativa enquanto o item estiver vestido.
   */
  suppresses(catalog: ReadonlyMap<string, Item>, condition: SuppressibleCondition): boolean {
    for (const carried of this.#equipped.values()) {
      if (catalog.get(carried.itemId)?.bonuses?.suppress?.includes(condition) === true) return true;
    }
    return false;
  }

  /**
   * A velocidade somada do que está vestido (#524: boots of haste). Molde de `armor()` — soma
   * simples, e zero é ninguém com bônus de velocidade, o caso comum.
   */
  speedBonus(catalog: ReadonlyMap<string, Item>): number {
    let total = 0;
    for (const carried of this.#equipped.values()) {
      total += catalog.get(carried.itemId)?.bonuses?.speed ?? 0;
    }
    return total;
  }

  /**
   * O MAGIC LEVEL ESPECIALIZADO do que está vestido, somado POR ELEMENTO (#680). O Canary
   * (`Player::getSpecializedMagicLevel`, `player.cpp:7606-7627`) varre os itens equipados na
   * hora do cálculo — nada é aplicado no equip —, e é o que isto faz: molde de
   * `combatModifiers()`. `undefined` quando NADA vestido declara o campo, o caso de todo o
   * conteúdo hoje, e é o que mantém a fórmula bit a bit sem o chamador conferir por fora.
   */
  specializedMagicLevel(catalog: ReadonlyMap<string, Item>): SpecializedMagicLevels | undefined {
    let total: Partial<Record<SpecializedMagicElement, number>> | undefined;
    for (const carried of this.#equipped.values()) {
      const points = catalog.get(carried.itemId)?.bonuses?.specializedMagicLevel;
      if (points === undefined) continue;
      total ??= {};
      for (const [element, amount] of Object.entries(points) as [SpecializedMagicElement, number | undefined][]) {
        if (amount !== undefined) total[element] = (total[element] ?? 0) + amount;
      }
    }
    return total;
  }

  /**
   * Os modificadores de crítico e leech do que está vestido, SOMADOS (M30-04, #551). Molde de
   * `armor()`/`skillBonus()`/`speedBonus()` — uma varredura dos poucos slots equipados, cada
   * campo ausente no item soma zero. Os quatro campos do item são pontos-base (×10000, a escala
   * do Canary — `itemCombatModifiersSchema`); aqui já viram a FRAÇÃO que `DamageModifiers` usa.
   *
   * `undefined` quando NADA equipado declara `combatModifiers` — o item comum de sempre, o caso
   * de todo o conteúdo hoje —, e é o que preserva bit a bit o v1/v2/v3 sem o chamador precisar
   * confirmar "nada equipado" por fora. `critical` só existe quando a CHANCE somada é > 0: como
   * `canApplyCritical = baseChance != 0 && ...` do Canary (`combat.cpp:2666`) curto-circuita —
   * `criticalDamage` sozinho, sem chance nenhuma, nunca faz um golpe crítico nem consome sorteio.
   */
  combatModifiers(catalog: ReadonlyMap<string, Item>): DamageModifiers | undefined {
    let criticalChance = 0;
    let criticalDamage = 0;
    let lifeLeech = 0;
    let manaLeech = 0;
    let increase: Partial<Record<DamageType, number>> | undefined;
    for (const carried of this.#equipped.values()) {
      const item = catalog.get(carried.itemId);
      // O aumento por tipo (#552) é outro campo do item, mas o mesmo lado do golpe (o ATACANTE),
      // e viaja no mesmo `DamageModifiers` para chegar a golpe, magia e runa sem outro parâmetro.
      if (item?.increase !== undefined) {
        increase ??= {};
        for (const type of DAMAGE_TYPES) {
          const value = item.increase[type];
          if (value !== undefined) increase[type] = (increase[type] ?? 0) + value;
        }
      }
      const modifiers = item?.combatModifiers;
      if (modifiers === undefined) continue;
      criticalChance += modifiers.criticalChance ?? 0;
      criticalDamage += modifiers.criticalDamage ?? 0;
      lifeLeech += modifiers.lifeLeech ?? 0;
      manaLeech += modifiers.manaLeech ?? 0;
    }
    if (criticalChance === 0 && lifeLeech === 0 && manaLeech === 0 && increase === undefined) {
      return undefined;
    }
    return {
      ...(increase === undefined ? {} : { increase }),
      ...(criticalChance === 0 ? {} : {
        critical: { chance: criticalChance / 10_000, multiplier: 1 + criticalDamage / 10_000 },
      }),
      ...(lifeLeech === 0 ? {} : { lifeLeech: lifeLeech / 10_000 }),
      ...(manaLeech === 0 ? {} : { manaLeech: manaLeech / 10_000 }),
    };
  }
}

/**
 * `a` pode entrar na pilha `b`? Mesmo id, item empilhável, e NENHUM dos dois com overlay (ADR
 * 0046 d.3) — somar duas instâncias com estado próprio apagaria o estado de uma delas.
 */
function stacksWith(definition: Item | undefined, a: CarriedItem, b: CarriedItem): boolean {
  return definition?.stackable === true && a.itemId === b.itemId
    && !hasItemOverlay(a) && !hasItemOverlay(b);
}

/**
 * A absorção do EQUIPAMENTO para o `combat-v3` (#552), na forma de `DefenderAbsorb`: a
 * percentual de CADA item na ordem de slot do Canary — `absorb.percent` e a fração de
 * `mitigation.resistances` (o mesmo `absorbpercent*`, ×100) — e a flat somada. `undefined`
 * quando nada vestido absorve, o caso comum, sem alocação.
 */
export function equipmentAbsorb(
  inventory: Inventory, catalog: ReadonlyMap<string, Item>,
): DefenderAbsorb | undefined {
  let items: Partial<Record<DamageType, number>>[] | undefined;
  let flat: Partial<Record<DamageType, number>> | undefined;
  for (const slot of CANARY_SLOT_ORDER) {
    const carried = inventory.equippedAt(slot);
    if (carried === null) continue;
    const item = catalog.get(carried.itemId);
    if (item === undefined) continue;
    let percents: Partial<Record<DamageType, number>> | undefined;
    for (const type of DAMAGE_TYPES) {
      // A fração legada vira percentual limpo: `0,07 × 100` é `7,000000000000001` em ponto
      // flutuante, e o arredondamento por item herdaria o resto.
      const resistance = Math.round(item.mitigation.resistances[type] * 10_000) / 100;
      const percent = (item.absorb?.[type]?.percent ?? 0) + resistance;
      if (percent !== 0) (percents ??= {})[type] = percent;
      const absorbFlat = item.absorb?.[type]?.flat ?? 0;
      if (absorbFlat !== 0) {
        flat ??= {};
        flat[type] = (flat[type] ?? 0) + absorbFlat;
      }
    }
    if (percents !== undefined) (items ??= []).push(percents);
  }
  if (items === undefined && flat === undefined) return undefined;
  return { items: items ?? [], flat: flat ?? {} };
}

/**
 * O reflexo do EQUIPAMENTO (#552): as tabelas compiladas dos itens vestidos, somadas (o
 * `Player::getReflectPercent`/`getReflectFlat` do Canary soma todos os equipados).
 * `undefined` quando nada vestido reflete.
 */
export function equipmentReflect(
  inventory: Inventory, catalog: ReadonlyMap<string, Item>,
): CompiledReflect | undefined {
  let total: { percent: Record<DamageType, number>; flat: Record<DamageType, number> } | undefined;
  for (const slot of CANARY_SLOT_ORDER) {
    const carried = inventory.equippedAt(slot);
    const reflect = carried === null ? undefined : catalog.get(carried.itemId)?.reflect;
    if (reflect === undefined) continue;
    total ??= { percent: { ...ZERO_BY_TYPE }, flat: { ...ZERO_BY_TYPE } };
    for (const type of DAMAGE_TYPES) {
      total.percent[type] += reflect.percent[type];
      total.flat[type] += reflect.flat[type];
    }
  }
  return total;
}

/** O `cleavepercent` somado do que está vestido (#552, `Player::getCleavePercent`). Zero é nada. */
export function equipmentCleavePercent(
  inventory: Inventory, catalog: ReadonlyMap<string, Item>,
): number {
  let total = 0;
  for (const slot of CANARY_SLOT_ORDER) {
    const carried = inventory.equippedAt(slot);
    if (carried !== null) total += catalog.get(carried.itemId)?.cleavePercent ?? 0;
  }
  return total;
}

/**
 * A mitigação do equipamento SEM a resistência (#552): no `combat-v3` a resistência do item é
 * absorção item a item (`equipmentAbsorb`), e só as imunidades continuam no estágio de
 * `mitigation`. Sem imunidade nenhuma, o objeto neutro de sempre — nenhuma alocação.
 */
export function immunitiesOnly(mitigation: CompiledMitigation): CompiledMitigation {
  if (mitigation.immunities.size === 0) return NEUTRAL_MITIGATION;
  return { resistances: NEUTRAL_MITIGATION.resistances, immunities: mitigation.immunities };
}

const ZERO_BY_TYPE: Readonly<Record<DamageType, number>> = {
  physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
  drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
};

/** O defensor sem equipamento que mitigue: identidade, e um objeto só para toda a sessão. */
const NEUTRAL_MITIGATION: CompiledMitigation = {
  resistances: {
    physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0,
    drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
  },
  immunities: new Set(),
};

/**
 * As regras de container de um personagem, do conteúdo (#160): a mochila é o item em `back`
 * (sem mochila, zero lugares — o loot vai para a bolsa), a bolsa e a linha são da progressão.
 * É a única ponte entre `Inventory` e o conteúdo, e mora aqui para ruleset e host lerem a
 * mesma coisa.
 */
export function containerRulesFor(
  inventory: Inventory, catalog: ReadonlyMap<string, Item>, progression: Progression,
): ContainerRules {
  const back = inventory.equippedAt('back');
  return {
    backpackSlots: back === null ? 0 : catalog.get(back.itemId)?.initialSlots ?? 0,
    satchelSlots: progression.satchelInitialSlots,
    row: progression.containerRow,
  };
}

function weightOf(catalog: ReadonlyMap<string, Item>, item: CarriedItem): number {
  return (catalog.get(item.itemId)?.weight ?? 0) * item.quantity;
}
