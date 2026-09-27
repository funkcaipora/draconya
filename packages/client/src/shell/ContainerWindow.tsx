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
//
// **O clique direito num item consumível abre "Usar"/"Usar com…"** (#726, ADR 0049 decisão 3):
// o mesmo `ContextMenu` da #724 (`ui/ContextMenu.tsx`), trazido de lá para não haver dois menus
// na mesma tela. "Usar" manda `use-item` na hora; "Usar com…" arma a mira (`state/aim.ts`,
// `startAimForItem`) e o PRÓXIMO clique no mundo/Batalha completa com `use-item-on` — o mesmo
// gesto de mirar do `use-slot` (ADR 0049 decisão 2). **A seção Suprimentos**, logo abaixo da
// mochila, expõe o estoque abstrato (`inventory.supplies`, ADR 0049 decisão 4): poção/runa/
// munição que caíram em loot e ainda não têm sprite próprio no catálogo (§ "Em aberto" —
// `catalogue.bot.supplies` não carrega `appearanceId` hoje), então a linha é nome + contagem.

import { useState, type DragEvent, type MouseEvent } from 'react';
import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { Inventory } from '../state/hud.js';
import { aimTracker } from '../state/aim.js';
import { nextUseItemSeq } from '../state/use-item-seq.js';
import { clickIntent, dropIntent, parsePlace, serializePlace } from './drag-intent.js';
import type { DragPlace } from './drag-intent.js';
import { isUsable, useIntent } from './use-item-intent.js';
import type { UseItemRef } from './use-item-intent.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';
import { Slot } from './ui/Slot.js';
import { ContextMenu } from './ui/ContextMenu.js';
import type { ContextMenuAction } from './ui/ContextMenu.js';

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

/** As duas ações de "Usar" (#726): direto, ou com mira. Reaproveitada por item e por suprimento. */
function useActions(ref: UseItemRef): ContextMenuAction[] {
  return [
    {
      label: 'Usar',
      onSelect: () => { sendIntent(useIntent(ref, nextUseItemSeq())); },
    },
    {
      label: 'Usar com…',
      onSelect: () => { aimTracker.startAimForItem(ref, nextUseItemSeq()); },
    },
  ];
}

interface MenuState { readonly x: number; readonly y: number; readonly ref: UseItemRef }

export function ContainerWindow({ container, collapsed = false, onToggle }: {
  container: 'backpack' | 'satchel'; collapsed?: boolean; onToggle?: () => void;
}) {
  const inventory = useHudSlice((state) => state.inventory);
  const catalogue = useHudSlice((state) => state.catalogue);
  const [menu, setMenu] = useState<MenuState | null>(null);
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
  const supplyById = new Map((catalogue.bot.supplies ?? []).map((supply) => [supply.id, supply]));
  const places = inventory[container];
  const used = places.filter((place) => place !== null).length;
  const supplies = container === 'backpack' ? inventory.supplies : [];

  const openMenu = (ref: UseItemRef, event: MouseEvent): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, ref });
  };

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
                    onDragOver={(event) => { event.preventDefault(); }}
                    onDrop={(event) => { dropOn(place, event, inventory); }}
                  >
                    <Slot size={26} empty icon={<span />} ariaLabel="lugar vazio" />
                  </li>
                );
              }
              const definition = byId.get(item.itemId);
              const name = definition?.name ?? item.itemId;
              const wearable = definition?.slot !== null && definition?.slot !== undefined;
              const usable = isUsable(definition?.kind);
              return (
                <li
                  key={item.instanceId}
                  onDragOver={(event) => { event.preventDefault(); }}
                  onDrop={(event) => { dropOn(place, event, inventory); }}
                >
                  <Slot
                    size={26}
                    kind="loot"
                    title={wearable ? `Vestir ${name}` : name}
                    draggable
                    onDragStart={(event) => { startDrag(place, event); }}
                    // O clique veste — o caminho do celular. Quem confere se dá é o servidor.
                    onClick={() => {
                      if (!wearable) return;
                      const intent = clickIntent(place, inventory);
                      if (intent !== null) sendIntent(intent);
                    }}
                    icon={<ItemSprite appearanceId={definition?.appearanceId} name={name} />}
                    // `exactOptionalPropertyTypes`: só entra a prop quando o conteúdo a declara.
                    {...(definition?.shortLabel === undefined ? {} : { label: definition.shortLabel })}
                    {...(usable ? { onContextMenu: (event: MouseEvent) => { openMenu({ instanceId: item.instanceId }, event); } } : {})}
                    count={item.quantity}
                  />
                </li>
              );
            })}
          </ul>
        )}
      {container === 'backpack' && supplies.length > 0 && (
        <div className="supply-section">
          <p className="supply-section-title">Suprimentos</p>
          <ul className="supply-list">
            {supplies.map((supply) => {
              const definition = supplyById.get(supply.id);
              const name = definition?.name ?? supply.id;
              return (
                <li
                  key={supply.id}
                  className="supply-row"
                  title={`Usar ${name}`}
                  onClick={() => { sendIntent(useIntent({ supplyId: supply.id }, nextUseItemSeq())); }}
                  onContextMenu={(event) => { openMenu({ supplyId: supply.id }, event); }}
                >
                  <span className="supply-row-name">{name}</span>
                  <span className="supply-row-count">{supply.quantity}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={useActions(menu.ref)}
          onClose={() => { setMenu(null); }}
        />
      )}
    </Panel>
  );
}
