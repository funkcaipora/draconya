// Mochila, equipamento e capacidade (§21.4, §21.5, FUN-82).
//
// **O que o personagem carrega é ESTADO QUENTE**, escrito só pela sessão dona (invariante 9), e
// o que vira linha no Postgres sai pelo extrato — como XP, gold e skill. Nada aqui escreve
// `item_instance`; a sessão registra onde as coisas estão e o `jobs` aplica.
//
// **Peso, não slots.** O paradigma é o do Tibia (§21.5): a mochila cabe o que a capacidade do
// personagem aguenta, e capacidade cresce com level. Contar espaços seria outro jogo — e seria
// um jogo em que a armadura pesada não custa nada.
//
// **Item no chão não existe** (§21.5). O que existe é o que está na mochila, o que está
// equipado, e o que está na Caixa de Loot da Sessão. Sem `stackpos`, sem cadáver como
// container, sem item largado — o §26 do documento de referência lista isso como rejeição
// deliberada, e é o que dispensa metade do modelo de mundo de uma engine de MMO.

import type { Item, ItemSlot } from '@draconya/content';

/** Teto de empilhamento (§21.5). Munição empilha; espada não empilha por não ser `stackable`. */
export const MAX_STACK = 100;

/** Um item carregado. `instanceId` é a IDENTIDADE — a linha de `item_instance` (FUN-76). */
export interface CarriedItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  /**
   * De onde veio (§25.3, #154). Ausente é `'loot'` — o snapshot anterior a #154 não tem a
   * chave, e tudo o que existia antes caiu de monstro. É o `origin` da linha de `item_instance`.
   */
  readonly origin?: 'loot' | 'vocation-choice';
}

export interface InventoryState {
  readonly backpack: readonly CarriedItem[];
  /** Slot → `instanceId`. O item equipado NÃO está na mochila; ele está no corpo. */
  readonly equipped: Readonly<Partial<Record<ItemSlot, CarriedItem>>>;
}

/** Por que um item não entrou, ou não foi equipado. Tipada: o jogador merece saber qual foi. */
export type InventoryRefusal =
  | 'over-capacity'
  | 'not-carried'
  | 'not-equippable'
  | 'level-too-low'
  | 'wrong-vocation'
  | 'stack-too-large'
  /** Arma de duas mãos com escudo vestido, ou escudo com arma de duas mãos na mão (#152). */
  | 'hands-full';

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

export class Inventory {
  #backpack: CarriedItem[] = [];
  readonly #equipped = new Map<ItemSlot, CarriedItem>();

  static fromState(state: InventoryState | undefined): Inventory {
    const inventory = new Inventory();
    if (state === undefined) return inventory;
    inventory.#backpack = [...state.backpack];
    for (const [slot, item] of Object.entries(state.equipped)) {
      if (item !== undefined) inventory.#equipped.set(slot as ItemSlot, item);
    }
    return inventory;
  }

  getState(): InventoryState {
    return {
      backpack: [...this.#backpack],
      equipped: Object.fromEntries(this.#equipped) as InventoryState['equipped'],
    };
  }

  get backpack(): readonly CarriedItem[] {
    return this.#backpack;
  }

  equippedAt(slot: ItemSlot): CarriedItem | null {
    return this.#equipped.get(slot) ?? null;
  }

  /**
   * O peso do que ele carrega — mochila MAIS equipado.
   *
   * Equipado conta: uma armadura vestida não fica mais leve por estar no corpo, e a alternativa
   * seria o jogador equipar tudo para carregar o dobro.
   */
  weight(catalog: ReadonlyMap<string, Item>): number {
    let total = 0;
    for (const item of this.#backpack) total += weightOf(catalog, item);
    for (const item of this.#equipped.values()) total += weightOf(catalog, item);
    return total;
  }

  /**
   * Põe na mochila, se couber. **Empilha quando o item é empilhável.**
   *
   * Recusa em vez de estourar a capacidade: o item que não cabe vai para a Caixa de Loot da
   * Sessão (§21.5), que é issue própria. Aqui a resposta é `over-capacity`, e quem chama
   * decide o que fazer com ela.
   */
  add(item: CarriedItem, catalog: ReadonlyMap<string, Item>, wearer: Wearer): InventoryResult {
    const definition = catalog.get(item.itemId);
    if (definition === undefined) return { ok: false, reason: 'not-carried' };
    if (item.quantity > MAX_STACK) return { ok: false, reason: 'stack-too-large' };

    const added = definition.weight * item.quantity;
    if (this.weight(catalog) + added > wearer.capacity) {
      return { ok: false, reason: 'over-capacity' };
    }

    // Empilhável junta na pilha existente, até o teto. Não empilhável vira linha nova, sempre:
    // duas espadas são duas identidades, e é essa identidade que carrega a proveniência.
    if (definition.stackable) {
      const index = this.#backpack.findIndex(
        (carried) => carried.itemId === item.itemId && carried.quantity < MAX_STACK,
      );
      const existing = this.#backpack[index];
      if (existing !== undefined && existing.quantity + item.quantity <= MAX_STACK) {
        this.#backpack[index] = { ...existing, quantity: existing.quantity + item.quantity };
        return OK;
      }
    }
    this.#backpack.push(item);
    return OK;
  }

  /** Tira da mochila e devolve o que saiu, ou `null` se não estava lá. */
  remove(instanceId: string): CarriedItem | null {
    const index = this.#backpack.findIndex((carried) => carried.instanceId === instanceId);
    if (index < 0) return null;
    const [removed] = this.#backpack.splice(index, 1);
    return removed ?? null;
  }

  /**
   * Veste o item, trocando pelo que já estava no slot (§21.4).
   *
   * As três recusas são as do §21.2: o item precisa ter slot, e o personagem precisa do level e
   * da vocação. Vocação é o mesmo campo que a magia usa (FUN-92) — e o personagem nasce sem
   * uma, então item de vocação é inacessível até o level 8 por construção.
   *
   * A troca não pode estourar a capacidade, e não estoura: o que sai do corpo vai para a
   * mochila, e o peso total não muda.
   */
  equip(
    instanceId: string, wearer: Wearer, catalog: ReadonlyMap<string, Item>,
  ): InventoryResult {
    const carried = this.#backpack.find((item) => item.instanceId === instanceId);
    if (carried === undefined) return { ok: false, reason: 'not-carried' };

    const definition = catalog.get(carried.itemId);
    if (definition?.slot === undefined) return { ok: false, reason: 'not-equippable' };
    if (definition.requires.level !== undefined && wearer.level < definition.requires.level) {
      return { ok: false, reason: 'level-too-low' };
    }
    if (
      definition.requires.vocationId !== undefined
      && wearer.vocationId !== definition.requires.vocationId
    ) {
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

    this.remove(instanceId);
    const previous = this.#equipped.get(definition.slot);
    this.#equipped.set(definition.slot, carried);
    // O que sai volta para a mochila. Peso total inalterado, então não há como esta troca
    // estourar a capacidade — e por isso não há conferência aqui.
    if (previous !== undefined) this.#backpack.push(previous);
    return OK;
  }

  /** Tira do corpo e devolve para a mochila. */
  unequip(slot: ItemSlot): InventoryResult {
    const equipped = this.#equipped.get(slot);
    if (equipped === undefined) return { ok: false, reason: 'not-carried' };
    this.#equipped.delete(slot);
    this.#backpack.push(equipped);
    return OK;
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
    if (definition.requires.level !== undefined && wearer.level < definition.requires.level) {
      return null;
    }
    if (
      definition.requires.vocationId !== undefined
      && wearer.vocationId !== definition.requires.vocationId
    ) {
      return null;
    }
    return definition;
  }

  /** A armadura somada do que está vestido. Zero é ninguém vestido, e é um número honesto. */
  armor(catalog: ReadonlyMap<string, Item>): number {
    let total = 0;
    for (const item of this.#equipped.values()) total += catalog.get(item.itemId)?.armor ?? 0;
    return total;
  }
}

function weightOf(catalog: ReadonlyMap<string, Item>, item: CarriedItem): number {
  return (catalog.get(item.itemId)?.weight ?? 0) * item.quantity;
}
