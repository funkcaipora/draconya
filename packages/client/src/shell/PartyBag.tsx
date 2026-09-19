// Party loot: a bolsa compartilhada como JANELA FLUTUANTE sobre o mundo (#316, RC-03; ADR 0030
// decisão 3). Título e meta são o texto ESTÁTICO do kit renderizado (Hud.jsx:201,
// `title="Party loot" meta="vendido e dividido ao fim"`) — o peso/capacidade real (que a versão
// antiga mostrava no meta) desce para o corpo, na linha "Cap total"/"... oz em uso", que É dado
// do servidor (`bag.weight`/`bag.capacity`); nada aqui é `data.js` do kit.
//
// Nasce aberta na hunt COM party (ADR 0030 decisão 3: "nascem abertas na hunt") — quem decide
// SE ela existe é `Shell.tsx` (`hunting && partyLootOpen`); aqui só se decide se o CONTEÚDO
// existe: sem party, sem `splitLoot`, ou sem `partyBag`, a janela não monta.
//
// O grid é FIXO em 6×2 (R4-23, Hud.jsx:202): os itens reais, o saldo de GOLD como um slot A MAIS
// (ADR 0030 §6: "o tile GOLD da Bolsa mostra o saldo, nunca um item" — o mesmo padrão que
// `EquipmentPanel.tsx` já usa para o personagem) e o resto preenchido com `Slot empty`.
//
// v2 (#405, ADR 0033 d.3): o valor total, a "sua capacidade reservada" (a MINHA entrada de
// `bag.reservations`, com o percentual) e o badge OVERWEIGHT quando `bag.overweight === true`.
// Cada campo só aparece quando o servidor o mandou — ausente é nó `game` anterior ao #400, ou
// "não se aplica", nunca um zero fabricado (D8). A janela monta por `splitLoot`, não pelo
// `mode` derivado: com os dois eixos independentes, a bolsa existe sse `splitLoot` está ligado.
//
// O "Último settlement" (real, pós-hunt) não está no kit renderizado nesta janela — é um DESVIO
// CONSCIENTE preservado da versão anterior (DT-04): informação real que nenhum outro lugar da
// tela mostra hoje, mantida como parágrafo a mais depois do texto do kit.

import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';
import { FloatingWindow } from './FloatingWindow.js';
import { reservedCapacityOf, splitLootOf } from './party-loot-format.js';
import { Slot } from './ui/Slot.js';

/** 6×2 (R4-23) — não cresce com o tamanho da bolsa; ver "Casos de borda" para o overflow. */
const GRID_SLOTS = 12;

export function PartyLootWindow({ onClose }: { onClose: () => void }) {
  const bag = useHudSlice((state) => state.partyBag);
  const partyView = useHudSlice((state) => state.party);
  const settlement = useHudSlice((state) => state.lastSettlement);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  if (partyView === null || !splitLootOf(partyView) || bag === null) return null;

  const named = (itemId: string) => catalogue?.items.find((item) => item.id === itemId);
  const settlementMine = settlement?.shares.find((share) => share.characterId === me)?.gold;
  const reserved = me === null ? null : reservedCapacityOf(bag, me);
  const capPercent = bag.capacity > 0 ? Math.min(100, Math.round((bag.weight / bag.capacity) * 100)) : 0;

  // GOLD é o slot a mais do kit (Hud.jsx:202, `["GOLD", "8.4k", ""]`), sempre presente — mesmo
  // saldo zero, como o tile de gold do personagem nunca some (EquipmentPanel.tsx).
  const goldCount = bag.gold.toLocaleString('pt-BR');
  // O grid é FIXO em 12 (R4-23): quando os itens passam do que cabe, os reais entram primeiro e
  // o que sobra vira UM chip `+N` no lugar do último slot — nenhum item é omitido da CONTAGEM,
  // só do desenho individual (DT-02, PRD §14: o limite é de slots, não de peso).
  const overflow = bag.items.length + 1 > GRID_SLOTS;
  const itemSlots = GRID_SLOTS - 1 - (overflow ? 1 : 0);
  const visibleItems = overflow ? bag.items.slice(0, itemSlots) : bag.items;
  const hiddenItems = bag.items.length - visibleItems.length;
  const realSlots = visibleItems.length + 1 + (overflow ? 1 : 0); // +1 é o GOLD
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
          {visibleItems.map((item) => {
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
          {overflow && (
            <Slot
              size={30}
              kind="loot"
              className="party-loot-overflow"
              label={`+${String(hiddenItems)}`}
              title={`${String(hiddenItems)} itens não desenhados`}
            />
          )}
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
          {/* v2 (#405): só com o campo no fio — `undefined` é nó anterior ao #400. */}
          {bag.value !== undefined && (
            <div className="party-loot-row">
              <span>Valor total</span>
              <b>{bag.value.toLocaleString('pt-BR')}</b>
            </div>
          )}
          {reserved !== null && (
            <div className="party-loot-row">
              <span>Sua capacidade reservada</span>
              <b>
                {`${reserved.reserved.toLocaleString('pt-BR')} oz`
                  + (reserved.percent === null ? '' : ` (${String(reserved.percent)} %)`)}
              </b>
            </div>
          )}
        </div>
        {bag.overweight === true && (
          <p className="party-loot-overweight" role="status">
            OVERWEIGHT — itens com peso não são coletados
          </p>
        )}
        <p className="party-loot-note">
          {'Cap = soma das capacidades dos membros, dividida entre eles. Ao fim da caçada a bolsa é vendida e o gold rateado.'}
        </p>
        {settlement !== null && (
          <p className="entry-meta">
            {`Último settlement: vendeu ${String(settlement.total)} gold${settlementMine === undefined ? '' : ` · você levou ${String(settlementMine)}`}`}
          </p>
        )}
      </div>
    </FloatingWindow>
  );
}
