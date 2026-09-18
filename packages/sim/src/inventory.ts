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

import { DAMAGE_TYPES } from '@draconya/content';
import type {
  CompiledMitigation, DamageType, Item, ItemSlot, Progression, RingEffect,
} from '@draconya/content';
import { NO_DEFENSE } from './combat/defense.js';
import type { DefenseSource } from './combat/defense.js';

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

export class Inventory {
  #backpack: (CarriedItem | null)[] = [];
  #satchel: (CarriedItem | null)[] = [];
  readonly #equipped = new Map<ItemSlot, CarriedItem>();
  /** Os tamanhos iniciais, para aparar linhas vazias do fim (`remove`). Zero até `ensureContainers`. */
  #initial = { backpack: 0, satchel: 0 };

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
    if (definition.stackable) {
      const index = target.findIndex(
        (carried) => carried !== null && carried.itemId === item.itemId
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
        if (definition?.stackable !== true || destination.itemId !== equipped.itemId
          || destination.quantity + equipped.quantity > MAX_STACK) {
          return { ok: false, reason: 'no-such-place' };
        }
        this.#equipped.delete(from.slot);
        this.#set(to as { container: ContainerName; index: number }, { ...destination, quantity: destination.quantity + equipped.quantity });
        return OK;
      }
      this.#equipped.delete(from.slot);
      this.#set(to as { container: ContainerName; index: number }, equipped);
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
    if (destination !== null && definition?.stackable === true && destination.itemId === source.itemId) {
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
    if (
      definition.requires.vocationId !== undefined
      && wearer.vocationId !== definition.requires.vocationId
    ) {
      return false;
    }
    return true;
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
      physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
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
}

/** O defensor sem equipamento que mitigue: identidade, e um objeto só para toda a sessão. */
const NEUTRAL_MITIGATION: CompiledMitigation = {
  resistances: { physical: 0, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
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
