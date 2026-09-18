// Party loot: a bolsa compartilhada como JANELA FLUTUANTE sobre o mundo (#316, RC-03; ADR 0030
// decisão 3). Título e meta são o texto ESTÁTICO do kit renderizado (Hud.jsx:201,
// `title="Party loot" meta="vendido e dividido ao fim"`) — o peso/capacidade real (que a versão
// antiga mostrava no meta) desce para o corpo, na linha "Cap total"/"... oz em uso", que É dado
// do servidor (`bag.weight`/`bag.capacity`); nada aqui é `data.js` do kit.
//
// Nasce aberta na hunt COM party (ADR 0030 decisão 3: "nascem abertas na hunt") — quem decide
// SE ela existe é `Shell.tsx` (`hunting && partyLootOpen`); aqui só se decide se o CONTEÚDO
// existe: sem party, fora do modo `shared`, ou sem `partyBag`, a janela não monta — a mesma
// regra de antes (ADR 0027 decisão 5), preservada porque não é isso que esta issue reabre.
//
// O grid é FIXO em 6×2 (R4-23, Hud.jsx:202): os itens reais, o saldo de GOLD como um slot A MAIS
// (ADR 0030 §6: "o tile GOLD da Bolsa mostra o saldo, nunca um item" — o mesmo padrão que
// `EquipmentPanel.tsx` já usa para o personagem) e o resto preenchido com `Slot empty`. Sem cap
// reservado (R4-21: a reserva não existe no servidor) e sem "valor est." (R4-22: falta `value`
// no catálogo — SV-01 acende esta linha depois).
//
// O "Último settlement" (real, pós-hunt) não está no kit renderizado nesta janela — é um DESVIO
// CONSCIENTE preservado da versão anterior (DT-04): informação real que nenhum outro lugar da
// tela mostra hoje, mantida como parágrafo a mais depois do texto do kit.

import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';
import { FloatingWindow } from './FloatingWindow.js';
import { Slot } from './ui/Slot.js';

/** 6×2 (R4-23) — não cresce com o tamanho da bolsa; ver "Casos de borda" para o overflow. */
const GRID_SLOTS = 12;

export function PartyLootWindow({ onClose }: { onClose: () => void }) {
  const bag = useHudSlice((state) => state.partyBag);
  const partyView = useHudSlice((state) => state.party);
  const settlement = useHudSlice((state) => state.lastSettlement);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  if (partyView === null || partyView.mode !== 'shared' || bag === null) return null;

  const named = (itemId: string) => catalogue?.items.find((item) => item.id === itemId);
  const mine = settlement?.shares.find((share) => share.characterId === me)?.gold;
  const capPercent = bag.capacity > 0 ? Math.min(100, Math.round((bag.weight / bag.capacity) * 100)) : 0;

  // GOLD é o slot a mais do kit (Hud.jsx:202, `["GOLD", "8.4k", ""]`), sempre presente — mesmo
  // saldo zero, como o tile de gold do personagem nunca some (EquipmentPanel.tsx).
  const goldCount = bag.gold.toLocaleString('pt-BR');
  const realSlots = bag.items.length + 1; // +1 é o GOLD
  const emptyCount = Math.max(0, GRID_SLOTS - realSlots);

  return (
    <FloatingWindow
      name="party-loot"
      title="Party loot"
      meta="vendido e dividido ao fim"
      onClose={onClose}
      width={236}
      initial={{ x: 12, y: 300 }}
    >
      <div className="party-loot" aria-label="party loot">
        <div className="party-loot-grid">
          {bag.items.map((item) => {
            const definition = named(item.itemId);
            const name = definition?.name ?? item.itemId;
            // `exactOptionalPropertyTypes` — mesmo padrão de antes: só entra na chamada quem de
            // fato veio.
            const countProps = item.quantity > 1 ? { count: item.quantity } : {};
            return (
              <span key={item.instanceId} title={name}>
                <Slot
                  size={30}
                  kind="loot"
                  label={name.slice(0, 4).toUpperCase()}
                  icon={definition !== undefined
                    ? <ItemSprite appearanceId={definition.appearanceId} name={definition.name} />
                    : undefined}
                  {...countProps}
                />
              </span>
            );
          })}
          <span title="gold">
            <Slot size={30} kind="loot" label="GOLD" count={goldCount} />
          </span>
          {Array.from({ length: emptyCount }, (_, index) => (
            <Slot key={`empty-${String(index)}`} size={30} empty />
          ))}
        </div>
        <div className="party-loot-totals">
          <div className="party-loot-row">
            <span>Cap total</span>
            <b>{bag.capacity.toLocaleString('pt-BR')}</b>
          </div>
          <div className="party-loot-bar" aria-label="capacidade em uso">
            <span className="party-loot-bar-fill" style={{ width: `${String(capPercent)}%` }} />
          </div>
          <div className="party-loot-row party-loot-row-faint">
            <span>{`${bag.weight.toLocaleString('pt-BR')} oz em uso`}</span>
          </div>
        </div>
        <p className="party-loot-note">
          {'Cap = soma das capacidades dos membros, dividida entre eles. Ao fim da caçada a bolsa é vendida e o gold rateado.'}
        </p>
        {settlement !== null && (
          <p className="entry-meta">
            {`Último settlement: vendeu ${String(settlement.total)} gold${mine === undefined ? '' : ` · você levou ${String(mine)}`}`}
          </p>
        )}
      </div>
    </FloatingWindow>
  );
}
