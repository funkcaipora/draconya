// O painel do set (#161, ADR 0026 decisão 7; herda FUN-90 e FUN-108).
//
// Os dez slots no desenho de corpo do Tibia — mochila no canto superior direito —, e a
// capacidade embaixo (o gold mora na TopBar, não aqui — R6-04). Fixo na coluna da direita,
// minimizável pelo próprio cabeçalho (RC-09/#322 — o botão ▸/▾ também controla ContainerWindow×2
// e PartyBag, que seguem o mesmo `open.inventory` sem botão próprio), nunca removido. Cada lugar
// é o primitivo `ui/Slot` (FD-07): borda dourada, tracejado nos sete lugares que o kit traceja,
// fundo claro vazio / marrom ocupado — tudo do próprio `Slot`, nada daqui.
//
// **Com uma arma de distância na mão, o escudo é o seletor de munição** (ADR 0026 decisão 3,
// restaurada na M18): a munição é abstrata, uma SELEÇÃO por família. A célula do escudo mostra a
// munição escolhida — ou vazia quando ainda não há seleção — com o preço por tiro; o clique abre
// o `AmmoPicker`. Sem bow/crossbow, o slot é um slot. O slot `ammo` do corpo continua genérico.
//
// O clique num item vestido desveste; soltar um item de container em cima veste. O cliente não
// soma peso (FUN-90) e não decide o que cabe: `capacity` vem pronto do servidor.

import { useState } from 'react';
import { ITEM_SLOTS } from '@draconya/content';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { AmmoPicker, ammoFamilyOf, ammoInUse } from './AmmoPicker.js';
import { dropOn, startDrag } from './ContainerWindow.js';
import { clickIntent } from './drag-intent.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';
import { Slot } from './ui/Slot.js';

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

/** Mão/Peito/Escudo saem com borda SÓLIDA no kit (Hud.jsx:52, `dashed={i!==4&&i!==3&&i!==5}`
 * sobre `DR.equip.flat()`, índices 3/4/5); os outros sete tracejam (R6-05). */
const SOLID_EQUIP_SLOTS = new Set<string>(['hand', 'chest', 'shield']);

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function EquipmentPanel({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);
  const ammo = useHudSlice((state) => state.ammo);
  const [picker, setPicker] = useState<string | null>(null);
  const panelProps = onToggle === undefined ? {} : { onToggle };

  if (inventory === null || catalogue === null) {
    return (
      <Panel dock title="Set" className="inventory" collapsed={collapsed} {...panelProps}>
        <p className="quiet">Carregando…</p>
      </Panel>
    );
  }

  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  const hand = inventory.equipped['hand'];
  const handDefinition = hand === undefined ? undefined : byId.get(hand.itemId);
  const ammoFamily = ammoFamilyOf(handDefinition?.weapon);

  return (
    <>
      <Panel
        dock
        title="Set"
        className="inventory"
        bodyClassName="inventory-body"
        collapsed={collapsed}
        {...panelProps}
      >
        <ul className="equipment">
          {ITEM_SLOTS.map((slot) => {
            const label = SLOT_TEXT[slot] ?? slot;
            const dashed = !SOLID_EQUIP_SLOTS.has(slot);
            // Com arma de distância na mão, o escudo é o seletor de munição (ADR 0026 d.3).
            if (slot === 'shield' && ammoFamily !== undefined) {
              const chosen = ammoFamily === 'arrow' ? ammo.arrow : ammoFamily === 'bolt' ? ammo.bolt : null;
              const inUse = ammoInUse(catalogue.ammunition, ammoFamily, chosen);
              const title = inUse === undefined
                ? 'Munição'
                : `${inUse.name} · ${String(inUse.price)} gold/tiro`;
              return (
                <li key={slot} className="slot-shield">
                  <Slot
                    size={30}
                    kind="equip"
                    dashed={dashed}
                    className="slot-ammo-picker"
                    title={title}
                    ariaLabel={`munição: ${title}`}
                    onClick={() => { setPicker(ammoFamily); }}
                    icon={inUse !== undefined ? <ItemSprite appearanceId={inUse.appearanceId} name={inUse.name} /> : undefined}
                  />
                </li>
              );
            }
            const item = inventory.equipped[slot];
            const definition = item === undefined ? undefined : byId.get(item.itemId);
            const name = definition?.name ?? item?.itemId ?? 'item';
            const countProps = item !== undefined && item.quantity > 1 ? { count: item.quantity } : {};
            return (
              <li
                key={slot}
                className={`slot-${slot}`}
                onDragOver={(event) => { event.preventDefault(); }}
                onDrop={(event) => { dropOn({ slot }, event, inventory); }}
              >
                {item === undefined
                  ? (
                    <Slot
                      size={30}
                      kind="equip"
                      dashed={dashed}
                      empty
                      label={label.slice(0, 4).toUpperCase()}
                      title={label}
                      ariaLabel={`${label} (vazio)`}
                    />
                  )
                  : (
                    <Slot
                      size={30}
                      kind="equip"
                      dashed={dashed}
                      title={`Tirar ${name}`}
                      draggable
                      onDragStart={(event) => { startDrag({ slot }, event); }}
                      onClick={() => {
                        const intent = clickIntent({ slot }, inventory);
                        if (intent !== null) sendIntent(intent);
                      }}
                      icon={<ItemSprite appearanceId={definition?.appearanceId} name={name} />}
                      {...countProps}
                    />
                  )}
              </li>
            );
          })}
        </ul>
        <div className="capacity">
          <span>Cap</span>
          <span>{`${integer.format(inventory.capacity.used)} / ${integer.format(inventory.capacity.total)} oz`}</span>
        </div>
      </Panel>
      {picker !== null && <AmmoPicker family={picker} onClose={() => { setPicker(null); }} />}
    </>
  );
}
