// A barra do topo, na casca do design (#251, #351 — D3, D8, D9 de docs/design-system-plan.md).
//
// Retrato-inicial (a cor de vocação chega com o sprite do outfit, SV-14), nome em Cinzel,
// "VOCAÇÃO · LV N", a pill de gold, o wordmark ao centro com contagem de jogadores online
// (SV-15, #351) e os seis ícones PNG de 36 px que abrem as janelas do M14. Nenhum ícone
// para sistema inexistente (Loja, Guild, Amigos, Prey, Configurações) — D8: o cliente nunca
// mostra o que o servidor não disse que existe.

import { useState } from 'react';
import { account } from '../account/store.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { ConnectionBadge } from './ConnectionBadge.js';

export type WindowId = 'hunts' | 'bot' | 'inventory' | 'analyzer' | 'bestiary' | 'chat';

/**
 * Os seis ícones da barra. `icon` é o arquivo em `public/hud-icons/<icon>.png` — arte do dono
 * do projeto, copiada do handoff (D9). `glyph` é o texto de reserva enquanto a imagem não
 * carrega: NUNCA emoji (D9 — "nenhum emoji, só glifos e PNG").
 */
const WINDOWS: ReadonlyArray<{ id: WindowId; label: string; icon: string; glyph: string }> = [
  { id: 'hunts', label: 'Hunts', icon: 'combat', glyph: 'HNT' },
  { id: 'bot', label: 'Bot', icon: 'actions', glyph: 'BOT' },
  { id: 'inventory', label: 'Inventário', icon: 'inventory', glyph: 'INV' },
  { id: 'analyzer', label: 'Analisador', icon: 'analyzer-chart', glyph: 'ANL' },
  { id: 'bestiary', label: 'Cyclopedia', icon: 'bestiary', glyph: 'CYC' },
  { id: 'chat', label: 'Chat', icon: 'chat', glyph: 'CHT' },
];

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Um ícone de 36 px, com o glifo de texto como reserva se o PNG falhar ao carregar. */
function NavIcon({ id, label, icon, glyph, open, onClick }: {
  id: WindowId; label: string; icon: string; glyph: string; open: boolean; onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={`topbar-icon-button${open ? ' topbar-icon-button-open' : ''}`}
      aria-pressed={open}
      title={label}
      data-window={id}
      onClick={onClick}
    >
      {failed
        ? <span className="topbar-icon-glyph" aria-hidden="true">{glyph}</span>
        : (
          <img
            className="topbar-icon-img"
            src={`/hud-icons/${icon}.png`}
            width={36}
            height={36}
            alt=""
            onError={() => { setFailed(true); }}
          />
        )}
      <span className="topbar-icon-label">{label}</span>
    </button>
  );
}

export function TopBar({ open, toggle }: {
  open: Readonly<Record<WindowId, boolean>>;
  toggle: (id: WindowId) => void;
}) {
  const characterId = useHudSlice((state) => state.characterId);
  const level = useHudSlice((state) => state.level);
  const gold = useHudSlice((state) => state.gold);
  // A vocação ao lado do level: o NOME vem do catálogo, o id do `player-stats` (herdado, #154).
  const vocationId = useHudSlice((state) => state.vocationId);
  const vocationName = useHudSlice((state) =>
    state.catalogue?.vocations.find((vocation) => vocation.id === state.vocationId)?.name ?? null);
  const characters = useStoreSlice(account, (state) => state.characters);
  const onlinePlayers = useHudSlice((state) => state.onlinePlayers);
  const name = characters.find((character) => character.id === characterId)?.name ?? null;
  const initial = (name ?? characterId ?? '?').slice(0, 1).toUpperCase();

  return (
    <header className="topbar" aria-label="barra do topo">
      <div className="topbar-left">
        {/* Sem onClick: "Personagem" é um painel fixo da coluna esquerda (DS-13), não um modal
            que este retrato abriria — D6. */}
        <span className="topbar-portrait" aria-hidden="true">{initial}</span>
        <div className="topbar-identity">
          <span className="topbar-name">{name ?? characterId ?? '—'}</span>
          <span className="topbar-vocation">
            {vocationId !== null && `${vocationName ?? vocationId} · `}
            {`LV ${String(level)}`}
          </span>
        </div>
        <div className="topbar-gold" title="gold">
          <span className="topbar-coin" aria-hidden="true" />
          {integer.format(gold)}
        </div>
      </div>
      <div className="topbar-wordmark">
        <b>DRACONYA</b>
        <span className="topbar-online">
          {onlinePlayers === null ? '—' : `${integer.format(onlinePlayers)} players online`}
        </span>
      </div>
      <div className="topbar-right">
        <nav className="topbar-nav" aria-label="janelas">
          {WINDOWS.map((window) => (
            <NavIcon
              key={window.id}
              id={window.id}
              label={window.label}
              icon={window.icon}
              glyph={window.glyph}
              open={open[window.id]}
              onClick={() => { toggle(window.id); }}
            />
          ))}
        </nav>
        <ConnectionBadge />
      </div>
    </header>
  );
}
