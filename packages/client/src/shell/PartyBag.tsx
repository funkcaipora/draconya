// A bolsa compartilhada (#197, ADR 0027 decisão 5): só existe no modo `shared`, na coluna da
// direita, abaixo dos containers. O que se mostra é o que o servidor mandou — itens, gold e
// `peso/capacidade` —, mais o último settlement, para quem ficou ler "vendeu N, você levou M".
// O cliente não soma peso nem calcula cota (invariante 4).
//
// A moldura é o `Panel` `dock` do design system (DS-04, #247): o resumo de peso/gold vai no
// `meta` do cabeçalho, e quem decide se o corpo existe é o `collapsed` que a barra do topo
// injeta ("quem decide se a janela existe é a barra", `packages/client/AGENTS.md`) — o próprio
// `Panel` some o corpo quando `collapsed` é `true`. Nenhum `onToggle` é passado: sem ele o
// `Panel` não desenha o próprio botão de minimizar, que duplicaria o da barra "Inventário".

import { useHudSlice } from '../state/useSlice.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';
import { Slot } from './ui/Slot.js';

/**
 * Duplicado de propósito em vez de importado de `PartyMembers.tsx`/`PartyPanel.tsx` — mesma
 * razão que o comentário de `PartyMembers.tsx:20-24` já documenta para o próprio `MODE_TEXT`:
 * três arquivos que mudam em issues diferentes não travam um no outro por uma constante de
 * duas entradas.
 */
export const MODE_TEXT: Record<'split' | 'shared', string> = { split: 'Dividido', shared: 'Compartilhado' };

// Cada arquivo do shell formata número com o seu próprio Intl.NumberFormat (mesmo padrão de
// `CharacterPanel.tsx:20-25`, comentado lá como DT-01: "não há módulo compartilhado ainda").
const count = (value: number): string => Math.round(value).toLocaleString('pt-BR');

export function PartyBag({ collapsed = false }: { collapsed?: boolean }) {
  const bag = useHudSlice((state) => state.partyBag);
  const partyView = useHudSlice((state) => state.party);
  const settlement = useHudSlice((state) => state.lastSettlement);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  if (partyView === null || partyView.mode !== 'shared' || bag === null) return null;

  const named = (itemId: string) => catalogue?.items.find((item) => item.id === itemId);
  const mine = settlement?.shares.find((share) => share.characterId === me)?.gold;
  // Sem "cap reservado" (docs/design-system-plan.md §4 — a reserva não existe no servidor):
  // só total e em uso.
  const capPercent = bag.capacity > 0 ? Math.min(100, Math.round((bag.weight / bag.capacity) * 100)) : 0;

  return (
    <Panel
      dock
      title={`Bolsa da party · ${MODE_TEXT[partyView.mode]}`}
      meta={`${count(bag.weight)}/${count(bag.capacity)} oz · ${count(bag.gold)} gold`}
      collapsed={collapsed}
    >
      <div className="party-bag" aria-label="bolsa da party">
        {bag.items.length === 0
          ? <p className="quiet">vazia</p>
          : (
            <div className="party-bag-grid">
              {bag.items.map((item) => {
                const definition = named(item.itemId);
                const name = definition?.name ?? item.itemId;
                // `exactOptionalPropertyTypes` não deixa passar `count={undefined}` (a prop é
                // `number | string`, sem `undefined` na união) — mesmo padrão de `BotPanel.tsx`:
                // só entra na chamada quem de fato veio.
                const countProps = item.quantity > 1 ? { count: item.quantity } : {};
                return (
                  // O nome completo vai no `title` — o mesmo padrão de `ContainerWindow.tsx`
                  // (`title={wearable ? \`Vestir ${name}\` : name}`): o slot mostra sprite e
                  // contagem, o nome é tooltip.
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
            </div>
          )}
        <div className="party-bag-cap" aria-label="capacidade em uso">
          <span className="party-bag-cap-fill" style={{ width: `${String(capPercent)}%` }} />
        </div>
        <p className="party-bag-note">
          Capacidade = soma das capacidades dos presentes · vendida e dividida ao sair alguém e no fim.
        </p>
        {settlement !== null && (
          <p className="entry-meta">
            {`Último settlement: vendeu ${count(settlement.total)} gold${mine === undefined ? '' : ` · você levou ${count(mine)}`}`}
          </p>
        )}
      </div>
    </Panel>
  );
}
