// A decisão de qual intenção um gesto no inventário manda (#161). PURA, sem React e sem DOM:
// os testes de tela rodam com `prerender`, que não dispara evento nenhum, então a lógica que
// vale a pena testar é a que decide a MENSAGEM — e o arrastar nativo por cima dela custa zero.
//
// Invariante 4: tudo aqui é intenção. Lugar → lugar é `move-item`; lugar → corpo é `equip`;
// corpo → lugar é `move-item` com `from: { slot }`. Nada confere level, vocação ou peso — quem
// decide é o servidor, e a recusa chega como `system-message`.

import type { C2SMessage } from '@draconya/protocol';
import type { Inventory } from '../state/hud.js';

export type DragPlace =
  | { readonly container: 'backpack' | 'satchel'; readonly index: number }
  | { readonly slot: string };

function samePlace(a: DragPlace, b: DragPlace): boolean {
  if ('slot' in a) return 'slot' in b && a.slot === b.slot;
  return 'container' in b && a.container === b.container && a.index === b.index;
}

/** A intenção de um arrastar. `null` quando não há o que mandar (origem vazia, mesmo lugar). */
export function dropIntent(from: DragPlace, to: DragPlace, inventory: Inventory): C2SMessage | null {
  if (samePlace(from, to)) return null;
  // Corpo → corpo não existe: não há "trocar de slot".
  if ('slot' in from && 'slot' in to) return null;
  if ('container' in from) {
    const item = inventory[from.container][from.index] ?? null;
    if (item === null) return null;
    // Lugar → corpo é vestir; o servidor decide o slot e recusa o que não veste.
    if ('slot' in to) return { type: 'equip', instanceId: item.instanceId };
    return { type: 'move-item', from, to };
  }
  // Corpo → lugar: desvestir PARA um lugar específico (#160, `move` com `from: { slot }`).
  if (inventory.equipped[from.slot] === undefined) return null;
  return { type: 'move-item', from: { slot: from.slot }, to };
}

/** O clique num lugar veste; o clique num slot desveste — o caminho do celular, sem arrastar. */
export function clickIntent(place: DragPlace, inventory: Inventory): C2SMessage | null {
  if ('slot' in place) {
    return inventory.equipped[place.slot] === undefined ? null : { type: 'unequip', slot: place.slot };
  }
  const item = inventory[place.container][place.index] ?? null;
  return item === null ? null : { type: 'equip', instanceId: item.instanceId };
}

/** O que o `dataTransfer` carrega: só o LUGAR de origem. Nunca o item — o servidor sabe o que está lá. */
export function serializePlace(place: DragPlace): string {
  return 'slot' in place ? `slot:${place.slot}` : `${place.container}:${String(place.index)}`;
}

export function parsePlace(text: string): DragPlace | null {
  const [kind, rest] = text.split(':', 2);
  if (kind === 'slot') return rest === undefined || rest.length === 0 ? null : { slot: rest };
  if (kind !== 'backpack' && kind !== 'satchel') return null;
  const index = Number(rest);
  if (!Number.isInteger(index) || index < 0) return null;
  return { container: kind, index };
}
