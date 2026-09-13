// Mochila, equipamento e capacidade (§21.5, §5.3, FUN-90, FUN-108).
//
// **Nada é calculado aqui.** Peso, capacidade e o que cabe vêm do servidor: quem sabe o que
// cabe é quem recusa, e a mesma conta em dois lugares diverge no primeiro item com peso
// fracionário — com a versão do cliente sendo a errada.
//
// **A geografia é fixa** (§5.3, §5.5): inventário, equipamento, chat e HP/mana ficam nos mesmos
// lugares em hunt e em conteúdo manual. A tela não se reorganiza ao trocar de atividade — em
// PvP manual, procurar onde a poção foi parar é o que custa a luta.
//
// Com arte (FUN-108): cada lugar é um SLOT como o do Tibia — o quadrado de pedra do pacote,
// o ícone cinza do lugar vazio, e o sprite do item quando há um. A mochila é uma grade de
// slots iguais, com a quantidade no canto. O que era clique continua clique: o slot vestido
// tira, o item que veste em algum lugar veste. Sem pacote, os mesmos slots em cor lisa, com a
// inicial do nome no lugar do sprite — `ItemSprite` decide isso, não este componente.

import type { CSSProperties } from 'react';
import { ITEM_SLOTS } from '@draconya/content';
import type { ItemSlot } from '@draconya/content';
import { slotVariable } from '../assets/ui.js';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { Inventory as InventoryState, ItemDefinition } from '../state/hud.js';
import { ItemSprite } from './ItemSprite.js';

/** Os dez lugares do §21.3 e do ADR 0026, em português e na ordem em que o corpo os usa. */
const SLOT_TEXT: Record<string, string> = {
  head: 'Cabeça',
  neck: 'Pescoço',
  chest: 'Peito',
  legs: 'Pernas',
  feet: 'Pés',
  hand: 'Mão',
  shield: 'Escudo',
  finger: 'Dedo',
  ammo: 'Munição',
  back: 'Mochila',
};

/**
 * O ícone cinza do lugar vazio entra por variável, e a variável é a de `assets/ui.ts` —
 * `--ui-slot-head`, `--ui-slot-hand`… Sem pacote ela não existe, e o CSS cai em "sem ícone".
 * Passar por `--slot-icon` em vez de uma classe por slot mantém UMA regra na folha.
 */
function slotStyle(slot: ItemSlot): CSSProperties {
  return { '--slot-icon': `var(${slotVariable(slot)})` } as CSSProperties;
}

/** O sprite e, quando há mais de um, a quantidade no canto — como o Tibia mostra pilha. */
function SlotContent({ definition, name, quantity }: {
  definition: ItemDefinition | undefined; name: string; quantity: number;
}) {
  return (
    <>
      <ItemSprite appearanceId={definition?.appearanceId} name={name} />
      {quantity > 1 && <span className="slot-count">{quantity}</span>}
    </>
  );
}

function Places({ places, byId, label, empty }: {
  places: readonly (NonNullable<InventoryState['backpack'][number]> | null)[];
  byId: ReadonlyMap<string, ItemDefinition>;
  label: string;
  empty: string;
}) {
  return (
    <ul className="backpack" aria-label={label}>
      {places.every((item) => item === null) && <li className="quiet">{empty}</li>}
      {places.map((item, index) => {
        if (item === null) return <li key={index} className="slot slot-empty-place" aria-label="lugar vazio" />;
        const definition = byId.get(item.itemId);
        const name = definition?.name ?? item.itemId;
        // Item que veste em algum lugar pode ser equipado; o resto é carga. Quem confere de
        // verdade é o servidor — isto só evita oferecer o que ele vai recusar.
        const wearable = definition?.slot !== null && definition?.slot !== undefined;
        return (
          <li key={item.instanceId} className="slot">
            {wearable
              ? (
                <button
                  type="button"
                  className="slot-button"
                  title={`Vestir ${name}`}
                  onClick={() => { sendIntent({ type: 'equip', instanceId: item.instanceId }); }}
                >
                  <SlotContent definition={definition} name={name} quantity={item.quantity} />
                </button>
              )
              : (
                <span className="slot-item" title={name}>
                  <SlotContent definition={definition} name={name} quantity={item.quantity} />
                </span>
              )}
          </li>
        );
      })}
    </ul>
  );
}

export function Inventory() {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);

  if (inventory === null || catalogue === null) {
    return (
      <section className="inventory" aria-label="inventário">
        <header className="analyzer-head">Inventário</header>
        <p className="quiet">Carregando…</p>
      </section>
    );
  }

  const byId = new Map(catalogue.items.map((item) => [item.id, item]));

  return (
    <section className="inventory" aria-label="inventário">
      <header className="analyzer-head">Inventário</header>
      <ul className="equipment">
        {ITEM_SLOTS.map((slot) => {
          // O equipado vem INTEIRO na mensagem — `instanceId`, `itemId`, `quantity` — porque
          // o item vestido NÃO está na mochila (o servidor o move ao equipar). Procurá-lo lá
          // era o que deixava o slot sem nome e sem sprite.
          const item = inventory.equipped[slot];
          const definition = item === undefined ? undefined : byId.get(item.itemId);
          const name = definition?.name ?? item?.itemId ?? 'item';
          const label = SLOT_TEXT[slot] ?? slot;
          return (
            <li key={slot} className={`slot slot-${slot}`} style={slotStyle(slot)}>
              {item === undefined
                ? <span className="slot-empty" role="img" aria-label={`${label} (vazio)`} title={label} />
                : (
                  <button
                    type="button"
                    className="slot-button"
                    title={`Tirar ${name}`}
                    // INTENÇÃO (invariante 4): o cliente diz qual lugar, e quem decide se dá
                    // é o servidor — a recusa vem como `system-message` e o chat a mostra.
                    onClick={() => { sendIntent({ type: 'unequip', slot }); }}
                  >
                    <SlotContent definition={definition} name={name} quantity={item.quantity} />
                  </button>
                )}
            </li>
          );
        })}
      </ul>

      <div className="capacity">
        {/* Os dois números do servidor, sem conta nenhuma no meio. */}
        {`${inventory.capacity.used.toFixed(0)} / ${inventory.capacity.total.toFixed(0)} oz`}
      </div>

      {/* Posicional (#160): cada lugar é um `li`, vazio ou com item; a bolsa é a segunda
          lista. A tela de verdade — arrastar, as duas janelas — é a #161. */}
      <Places places={inventory.backpack} byId={byId} label="mochila" empty="Mochila vazia" />
      <Places places={inventory.satchel} byId={byId} label="bolsa" empty="Bolsa vazia" />
    </section>
  );
}
