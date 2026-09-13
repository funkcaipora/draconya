// A barra do topo (FUN-115): quem é o jogador, como ele está, e as janelas que ele pode abrir.
//
// É a geografia do Huntera, que é a referência visual: o mundo ocupa a tela inteira, e o que
// não é mundo flutua por cima — uma faixa translúcida no topo com nome, level, vitais, gold e
// os ícones das janelas. Antes disto havia três colunas de pedra com um canvas pequeno no meio.

import { account } from '../account/store.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { ConnectionBadge } from './ConnectionBadge.js';
import { Vitals } from './Vitals.js';

export type WindowId = 'hunts' | 'bot' | 'inventory' | 'analyzer' | 'bestiary';

const WINDOWS: ReadonlyArray<{ id: WindowId; label: string; icon: string }> = [
  { id: 'hunts', label: 'Hunts', icon: '⚔' },
  { id: 'bot', label: 'Bot', icon: '⚙' },
  { id: 'inventory', label: 'Inventário', icon: '🎒' },
  { id: 'analyzer', label: 'Analisador', icon: '📈' },
  { id: 'bestiary', label: 'Bestiário', icon: '📖' },
];

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function TopBar({ open, toggle }: {
  open: Readonly<Record<WindowId, boolean>>;
  toggle: (id: WindowId) => void;
}) {
  const characterId = useHudSlice((state) => state.characterId);
  const level = useHudSlice((state) => state.level);
  const gold = useHudSlice((state) => state.gold);
  // A vocação ao lado do level (#154): o NOME vem do catálogo, o id do `player-stats`.
  const vocationId = useHudSlice((state) => state.vocationId);
  const vocationName = useHudSlice((state) =>
    state.catalogue?.vocations.find((vocation) => vocation.id === state.vocationId)?.name ?? null);
  // O nome vem da lista da conta: o HUD só conhece o id, e o nome é o que a tela do Huntera
  // mostra ao lado do level. Ausente (entrou pela URL, FUN-97) fica o id, que ao menos é dele.
  // A LISTA é a fatia, e a busca é daqui: `useStoreSlice` memoiza por estado da store, e um
  // seletor que fecha sobre `characterId` devolvia o `null` de antes do `welcome` para sempre.
  const characters = useStoreSlice(account, (state) => state.characters);
  const name = characters.find((character) => character.id === characterId)?.name ?? null;

  return (
    <header className="topbar" aria-label="barra do topo">
      <div className="topbar-identity">
        <span className="topbar-name">{name ?? characterId ?? '—'}</span>
        <span className="topbar-level">
          {`LV ${String(level)}`}
          {vocationId !== null && ` · ${vocationName ?? vocationId}`}
        </span>
      </div>
      <Vitals />
      <div className="topbar-gold" title="gold">
        <span className="topbar-coin" aria-hidden="true" />
        {integer.format(gold)}
      </div>
      <nav className="topbar-nav" aria-label="janelas">
        {WINDOWS.map((window) => (
          <button
            key={window.id}
            type="button"
            className={`topbar-button${open[window.id] ? ' topbar-button-open' : ''}`}
            aria-pressed={open[window.id]}
            title={window.label}
            onClick={() => { toggle(window.id); }}
          >
            <span className="topbar-icon" aria-hidden="true">{window.icon}</span>
            <span className="topbar-label">{window.label}</span>
          </button>
        ))}
      </nav>
      <ConnectionBadge />
    </header>
  );
}
