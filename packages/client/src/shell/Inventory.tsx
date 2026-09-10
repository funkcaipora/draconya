// Mochila, equipamento e capacidade (§21.5, §5.3, FUN-90).
//
// **Nada é calculado aqui.** Peso, capacidade e o que cabe vêm do servidor: quem sabe o que
// cabe é quem recusa, e a mesma conta em dois lugares diverge no primeiro item com peso
// fracionário — com a versão do cliente sendo a errada.
//
// **A geografia é fixa** (§5.3, §5.5): inventário, equipamento, chat e HP/mana ficam nos mesmos
// lugares em hunt e em conteúdo manual. A tela não se reorganiza ao trocar de atividade — em
// PvP manual, procurar onde a poção foi parar é o que custa a luta.
//
// Sem arte por enquanto: o `appearanceId` existe em cada item e o pipeline que o transforma em
// sprite é o M2. Até lá, a inicial do nome num quadrado — placeholder que não finge ser arte.

import { ITEM_SLOTS } from '@draconya/content';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { ItemDefinition } from '../state/hud.js';

/** Os nove lugares do §21.3, em português e na ordem em que o corpo os usa. */
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
};

/** Um quadrado com a inicial. Placeholder honesto: não finge ser o sprite que o M2 traz. */
function Icon({ definition }: { definition: ItemDefinition | undefined }) {
  return (
    <span className="item-icon" title={definition?.name ?? 'item desconhecido'}>
      {(definition?.name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Inventory() {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);

  if (inventory === null || catalogue === null) {
    return (
      <section className="inventory" aria-label="inventário">
        <p className="quiet">Carregando…</p>
      </section>
    );
  }

  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  // `instanceId` → o que ele é, para o equipado saber o próprio nome sem uma segunda lista.
  const carried = new Map(inventory.backpack.map((item) => [item.instanceId, item]));

  return (
    <section className="inventory" aria-label="inventário">
      <ul className="equipment">
        {ITEM_SLOTS.map((slot) => {
          const instanceId = inventory.equipped[slot];
          const item = instanceId === undefined ? undefined : carried.get(instanceId);
          const definition = item === undefined ? undefined : byId.get(item.itemId);
          return (
            <li key={slot} className="equipment-slot">
              <span className="entry-meta">{SLOT_TEXT[slot] ?? slot}</span>
              {instanceId === undefined
                ? <span className="equipment-empty">—</span>
                : (
                  <button
                    type="button"
                    title={`Tirar ${definition?.name ?? 'item'}`}
                    // INTENÇÃO (invariante 4): o cliente diz qual lugar, e quem decide se dá
                    // é o servidor — a recusa vem como `system-message` e o chat a mostra.
                    onClick={() => { sendIntent({ type: 'unequip', slot }); }}
                  >
                    <Icon definition={definition} />
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

      <ul className="backpack">
        {inventory.backpack.length === 0 && <li className="quiet">Mochila vazia</li>}
        {inventory.backpack.map((item) => {
          const definition = byId.get(item.itemId);
          // Item que veste em algum lugar pode ser equipado; o resto é carga. Quem confere de
          // verdade é o servidor — isto só evita oferecer o que ele vai recusar.
          const wearable = definition?.slot !== null && definition?.slot !== undefined;
          return (
            <li key={item.instanceId} className="backpack-item">
              <Icon definition={definition} />
              <span className="backpack-name">{definition?.name ?? item.itemId}</span>
              {item.quantity > 1 && <span className="entry-meta">{`×${String(item.quantity)}`}</span>}
              {wearable && (
                <button
                  type="button"
                  onClick={() => { sendIntent({ type: 'equip', instanceId: item.instanceId }); }}
                >
                  vestir
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
