// O painel do set (#161, ADR 0026 decisão 7; herda FUN-90 e FUN-108).
//
// Os dez slots no desenho de corpo do Tibia — mochila no canto superior direito —, a capacidade
// e o gold embaixo (o gold é escolha nossa, copiada do Huntera: o cliente do Tibia o mostra na
// bolsa de moedas). Fixo na coluna da direita, minimizável pela barra do topo, nunca removido.
//
// **Com uma arma de distância na mão, o escudo é o seletor de munição** (ADR 0026 decisão 3):
// a célula mostra a munição em uso — a escolhida, ou a grátis, que é o que o servidor atira
// quando não há escolha — com o preço por tiro; o clique abre o `AmmoPicker`. Sem bow, o slot é
// um slot.
//
// O clique num item vestido desveste; soltar um item de container em cima veste. O cliente não
// soma peso (FUN-90) e não decide o que cabe: `capacity` vem pronto do servidor.

import { useState } from 'react';
import { ITEM_SLOTS } from '@draconya/content';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { ItemDefinition } from '../state/hud.js';
import { AmmoPicker, ammoInUse } from './AmmoPicker.js';
import { dropOn, startDrag } from './ContainerWindow.js';
import { clickIntent } from './drag-intent.js';
import { ItemSprite } from './ItemSprite.js';

/**
 * Os dez lugares do §21.3 e do ADR 0026, em português e na ordem em que o corpo os usa.
 *
 * Exportado desde a #344 (SV-08): é a mesma "categoria derivada do slot" que a aba Itens do
 * Cyclopedia usa — reaproveitar em vez de duplicar evita que os dois rótulos divirjam (ex.:
 * um chamando `finger` de "Dedo" e o outro de "Anel").
 */
export const SLOT_TEXT: Record<string, string> = {
  head: 'Cabeça', neck: 'Pescoço', chest: 'Peito', legs: 'Pernas', feet: 'Pés',
  hand: 'Mão', shield: 'Escudo', finger: 'Dedo', ammo: 'Munição', back: 'Mochila',
};

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

// A skin de pedra do pacote saiu inteira em #250 (ADR 0029 D4): não há mais variável nenhuma
// para injetar por `<li style={...}>` — o lugar vazio mostra o rótulo em texto (ver
// `.slot-empty` em `shell.css`).

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

export function EquipmentPanel({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);
  const gold = useHudSlice((state) => state.gold);
  const ammo = useHudSlice((state) => state.ammo);
  const [picker, setPicker] = useState<string | null>(null);

  const header = (
    <header className="analyzer-head">
      <strong>Set</strong>
      {onToggle !== undefined && (
        <button type="button" className="entry-quiet" aria-label={collapsed ? 'expandir' : 'minimizar'} onClick={onToggle}>
          {collapsed ? '▸' : '▾'}
        </button>
      )}
    </header>
  );

  if (inventory === null || catalogue === null) {
    return (
      <section className={`inventory${collapsed ? ' collapsed' : ''}`} aria-label="set">
        {header}
        <p className="quiet">Carregando…</p>
      </section>
    );
  }

  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  const hand = inventory.equipped['hand'];
  const handDefinition = hand === undefined ? undefined : byId.get(hand.itemId);
  const ammoFamily = handDefinition?.weapon?.kind === 'distance' ? handDefinition.weapon.ammoFamily : undefined;

  return (
    <section className={`inventory${collapsed ? ' collapsed' : ''}`} aria-label="set">
      {header}
      <ul className="equipment">
        {ITEM_SLOTS.map((slot) => {
          const label = SLOT_TEXT[slot] ?? slot;
          // Com arma de distância na mão, o escudo é o seletor de munição (ADR 0026 d.3).
          if (slot === 'shield' && ammoFamily !== undefined) {
            const chosen = ammoFamily === 'arrow' ? ammo.arrow : ammoFamily === 'bolt' ? ammo.bolt : null;
            const inUse = ammoInUse(catalogue.ammunition, ammoFamily, chosen);
            const title = inUse === undefined
              ? 'Munição'
              : `${inUse.name} · ${inUse.price === 0 ? 'grátis' : `${String(inUse.price)} gold/tiro`}`;
            return (
              <li key={slot} className="slot slot-shield slot-ammo-picker">
                <button type="button" className="slot-button" title={title} aria-label={`munição: ${title}`} onClick={() => { setPicker(ammoFamily); }}>
                  {inUse !== undefined && <ItemSprite appearanceId={inUse.appearanceId} name={inUse.name} />}
                </button>
              </li>
            );
          }
          const item = inventory.equipped[slot];
          const definition = item === undefined ? undefined : byId.get(item.itemId);
          const name = definition?.name ?? item?.itemId ?? 'item';
          return (
            <li
              key={slot}
              className={`slot slot-${slot}`}
              onDragOver={(event) => { event.preventDefault(); }}
              onDrop={(event) => { dropOn({ slot }, event, inventory); }}
            >
              {item === undefined
                // O rótulo do lugar, maiúsculo e cortado em 4 letras (#253, ADR 0029 D4), substitui
                // o ícone cinza do pacote — a mesma regra do "—" de sempre: sem dado, a tela nunca
                // deixa vazio quebrado. `aria-label`/`title` continuam com o nome INTEIRO; só o
                // texto visível é cortado, como o `EquipmentSet` do handoff faz com todo nome.
                ? <span className="slot-empty" aria-label={`${label} (vazio)`} title={label}>{label.slice(0, 4).toUpperCase()}</span>
                : (
                  <button
                    type="button"
                    className="slot-button"
                    draggable
                    title={`Tirar ${name}`}
                    onDragStart={(event) => { startDrag({ slot }, event); }}
                    // INTENÇÃO (invariante 4): o cliente diz qual lugar; quem decide é o servidor.
                    onClick={() => {
                      const intent = clickIntent({ slot }, inventory);
                      if (intent !== null) sendIntent(intent);
                    }}
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
        <span>{`${inventory.capacity.used.toFixed(0)} / ${inventory.capacity.total.toFixed(0)} oz`}</span>
        <span className="capacity-gold" title="gold"><span className="topbar-coin" aria-hidden="true" />{integer.format(gold)}</span>
      </div>
      {picker !== null && <AmmoPicker family={picker} onClose={() => { setPicker(null); }} />}
    </section>
  );
}
