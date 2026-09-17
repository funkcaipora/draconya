// A janela de um container — a mochila ou a bolsa (#161, ADR 0026 decisão 7).
//
// Uma `MiniWindow` do OTClient, empilhada abaixo do set na coluna da direita: título com o
// sprite do container e o nome, e uma grade de 5 lugares por linha — uma linha da tela é uma
// linha do container (#160 cresce de 5 em 5), então "abriu uma linha" fica visível. `null` é
// lugar vazio, desenhado como um quadrado de cor lisa (a skin de pedra do pacote saiu em
// #250, ADR 0029 D4); pilha mostra a quantidade no canto, como o Tibia.
//
// **Fixa e minimizável, nunca removida.** O clique veste (o caminho do celular); arrastar move
// entre lugares ou para o corpo. A decisão de qual intenção sai é `drag-intent.ts`, puro; o
// DnD nativo só carrega o LUGAR de origem — nunca o item.

import type { DragEvent } from 'react';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { Inventory } from '../state/hud.js';
import { clickIntent, dropIntent, parsePlace, serializePlace } from './drag-intent.js';
import type { DragPlace } from './drag-intent.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';

const TITLE: Readonly<Record<'backpack' | 'satchel', string>> = { backpack: 'Mochila', satchel: 'Bolsa' };

/** Solta o que o `dataTransfer` trouxe num lugar, e manda a intenção que couber. */
export function dropOn(to: DragPlace, event: DragEvent, inventory: Inventory): void {
  event.preventDefault();
  const from = parsePlace(event.dataTransfer.getData('text/plain'));
  if (from === null) return;
  const intent = dropIntent(from, to, inventory);
  if (intent !== null) sendIntent(intent);
}

export function startDrag(place: DragPlace, event: DragEvent): void {
  event.dataTransfer.setData('text/plain', serializePlace(place));
  event.dataTransfer.effectAllowed = 'move';
}

export function ContainerWindow({ container, collapsed = false, onToggle }: {
  container: 'backpack' | 'satchel'; collapsed?: boolean; onToggle?: () => void;
}) {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);
  const title = TITLE[container];
  const panelProps = onToggle === undefined ? {} : { onToggle };

  if (inventory === null || catalogue === null) {
    return (
      <Panel dock title={title} className="container-window" collapsed={collapsed} {...panelProps}>
        <p className="quiet">Carregando…</p>
      </Panel>
    );
  }

  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  const places = inventory[container];
  const used = places.filter((place) => place !== null).length;

  return (
    <Panel
      dock
      title={title}
      className="container-window"
      meta={`${String(used)}/${String(places.length)}`}
      collapsed={collapsed}
      {...panelProps}
    >
      {places.length === 0
        ? <p className="quiet">{container === 'backpack' ? 'Sem mochila nas costas' : 'Bolsa vazia'}</p>
        : (
          <ul className="container-grid">
            {places.map((item, index) => {
              const place: DragPlace = { container, index };
              if (item === null) {
                return (
                  <li
                    key={index}
                    className="slot slot-empty-place"
                    aria-label="lugar vazio"
                    onDragOver={(event) => { event.preventDefault(); }}
                    onDrop={(event) => { dropOn(place, event, inventory); }}
                  />
                );
              }
              const definition = byId.get(item.itemId);
              const name = definition?.name ?? item.itemId;
              const wearable = definition?.slot !== null && definition?.slot !== undefined;
              return (
                <li
                  key={item.instanceId}
                  className="slot"
                  onDragOver={(event) => { event.preventDefault(); }}
                  onDrop={(event) => { dropOn(place, event, inventory); }}
                >
                  <button
                    type="button"
                    className="slot-button"
                    draggable
                    title={wearable ? `Vestir ${name}` : name}
                    onDragStart={(event) => { startDrag(place, event); }}
                    // O clique veste — o caminho do celular. Quem confere se dá é o servidor.
                    onClick={() => {
                      if (!wearable) return;
                      const intent = clickIntent(place, inventory);
                      if (intent !== null) sendIntent(intent);
                    }}
                  >
                    <ItemSprite appearanceId={definition?.appearanceId} name={name} />
                    {item.quantity > 1 && <span className="slot-count">{item.quantity}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </Panel>
  );
}
