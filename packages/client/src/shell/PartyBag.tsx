// A bolsa compartilhada (#197, ADR 0027 decisão 5): só existe no modo `shared`, na coluna da
// direita, abaixo dos containers. O que se mostra é o que o servidor mandou — itens, gold e
// `peso/capacidade` —, mais o último settlement, para quem ficou ler "vendeu N, você levou M".
// O cliente não soma peso nem calcula cota (invariante 4).

import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';

export function PartyBag({ collapsed = false }: { collapsed?: boolean }) {
  const bag = useHudSlice((state) => state.partyBag);
  const partyView = useHudSlice((state) => state.party);
  const settlement = useHudSlice((state) => state.lastSettlement);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  if (partyView === null || partyView.mode !== 'shared' || bag === null) return null;

  const named = (itemId: string) => catalogue?.items.find((item) => item.id === itemId);
  const mine = settlement?.shares.find((share) => share.characterId === me)?.gold;

  return (
    <section className={`party-bag${collapsed ? ' collapsed' : ''}`} aria-label="bolsa da party">
      <header className="analyzer-head">
        <strong>Bolsa da party</strong>
        <span className="entry-meta">{`${String(bag.weight)}/${String(bag.capacity)} oz · ${String(bag.gold)} gold`}</span>
      </header>
      {!collapsed && (
        <>
          {bag.items.length === 0
            ? <p className="quiet">vazia</p>
            : (
              <ul className="party-bag-items">
                {bag.items.map((item) => {
                  const definition = named(item.itemId);
                  return (
                    <li key={item.instanceId} className="party-bag-item">
                      {definition !== undefined && <ItemSprite appearanceId={definition.appearanceId} name={definition.name} />}
                      <span>{definition?.name ?? item.itemId}</span>
                      {item.quantity > 1 && <span className="entry-meta">{`×${String(item.quantity)}`}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          {settlement !== null && (
            <p className="entry-meta">
              {`Último settlement: vendeu ${String(settlement.total)} gold${mine === undefined ? '' : ` · você levou ${String(mine)}`}`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
