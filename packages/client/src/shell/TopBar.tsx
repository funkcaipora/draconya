// A barra do topo, na casca do design (#251 — D3, D8, D9 de docs/design-system-plan.md;
// reordenada em #322/RC-09 sob o ADR 0030).
//
// Retrato do PRÓPRIO personagem (SV-14, #350): o sprite do outfit dele, pintado com as cores
// que o protocolo carregou (`paintOf`), assim que `world.selfId` e a criatura correspondente
// existem — e a inicial do nome enquanto isso não acontece (cidade recém-entrada, ou a corrida
// entre o `welcome` e o primeiro `session-state`/`creature-appear`). Nome em Cinzel,
// "VOCAÇÃO · LV N", a pill de gold, o wordmark ao centro com a contagem de jogadores online
// (SV-15, #351 — "—" até o primeiro `player-count` ou `session-state.onlinePlayers`) e os CINCO
// ícones PNG de 36 px que abrem as janelas, na MESMA ordem do kit (`Hud.jsx:2`): Personagem,
// Hunts, Analisador, Cyclopedia, Chat. Nenhum ícone para sistema inexistente (Loja, Guild,
// Amigos, Prey, Configurações) — D8: o cliente nunca mostra o que o servidor não disse que
// existe.
//
// Bot e Inventário SAÍRAM daqui (R1-09, RC-09/#322 — revoga DS-08 de docs/design-system-plan.md):
// quem minimiza esses painéis agora é só o próprio cabeçalho de cada um (o painel do bot já usava
// `Panel`+`onToggle`; `EquipmentPanel` já tinha o próprio botão ▸/▾ — nenhum dos dois precisou de
// código novo, só perderam o segundo gatilho que a TopBar oferecia).
//
// `world` não tem `subscribe` (ADR 0007): um `creature-appear` não pode causar render de React,
// então o retrato amostra por INTERVALO — o mesmo `HEALTH_POLL_MS` que `BattlePanel` e
// `PartyMembers` já usam para o mesmo mundo mutável.

import { useEffect, useState } from 'react';
import { account } from '../account/store.js';
import type { OutfitColors } from '../assets/outfit.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';
import { paintOf } from '../world/outfit-colors.js';
import { IconButton } from './ui/IconButton.js';
import { OutfitSprite } from './OutfitSprite.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';
import type { ChatBadgeTier } from './chat-badge.js';

export type WindowId = 'character' | 'hunts' | 'inventory' | 'analyzer' | 'bestiary' | 'chat';
// 'inventory' continua válido como chave de `open` (Shell.tsx o usa para o cabeçalho do
// EquipmentPanel) — só não aparece no array `WINDOWS` abaixo, que é o que desenha a nav.

/**
 * Os CINCO ícones da barra, na ORDEM do kit (`Hud.jsx:2` — `nav` = [character, combat, analyzer,
 * loot(Cyclopedia), guild, social, prey, chat], sem os três que não têm sistema — RC-09/#322).
 * `icon` é o arquivo em `public/hud-icons/<icon>.png` — arte do dono do projeto, copiada do
 * handoff (D9). `glyph` é o texto de reserva enquanto a imagem não carrega: NUNCA emoji
 * (D9 — "nenhum emoji, só glifos e PNG").
 */
const WINDOWS: ReadonlyArray<{ id: WindowId; label: string; icon: string; glyph: string }> = [
  { id: 'character', label: 'Personagem', icon: 'character', glyph: 'PER' },
  { id: 'hunts', label: 'Hunts', icon: 'combat', glyph: 'HNT' },
  { id: 'analyzer', label: 'Analisador', icon: 'analyzer-chart', glyph: 'ANL' },
  { id: 'bestiary', label: 'Cyclopedia', icon: 'bestiary', glyph: 'CYC' },
  { id: 'chat', label: 'Chat', icon: 'chat', glyph: 'CHT' },
];

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/**
 * O outfit do PRÓPRIO personagem, se ele já existe no mundo (SV-14). `null` enquanto
 * `world.selfId` não chegou ou a criatura correspondente ainda não apareceu — a corrida entre o
 * `welcome` (que traz o `characterId`) e o `session-state`/`creature-appear` (que traz a
 * criatura). O retrato cai para a inicial nesse meio-tempo, nunca para um sprite inventado.
 */
function selfOutfit(): { appearanceId: number; colors: OutfitColors } | null {
  if (world.selfId === null) return null;
  const self = world.creatures.get(world.selfId);
  if (self === undefined) return null;
  return { appearanceId: self.appearanceId, colors: paintOf(self) };
}

/**
 * Um ícone de 36 px (R0-05: o uso mais visível do `IconButton` no kit), com o glifo de texto
 * como reserva se o PNG falhar ao carregar. Nenhum rótulo de texto permanente é renderizado
 * (R1-10), apenas o tooltip nativo `title`. O selo do Chat (#323) é a única decoração extra.
 */
function NavIcon({ id, label, icon, glyph, open, badge, onClick }: {
  id: WindowId; label: string; icon: string; glyph: string; open: boolean;
  badge: ChatBadgeTier | null; onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const badgeClass = badge === 'gold' ? 'topbar-icon-button-badge-gold' : undefined;
  return (
    <IconButton
      size="lg"
      title={label}
      active={open}
      onClick={onClick}
      data-window={id}
      {...(badgeClass === undefined ? {} : { className: badgeClass })}
    >
      {failed
        ? <span className="topbar-icon-glyph" aria-hidden="true">{glyph}</span>
        : (
          <img
            className="topbar-icon-img"
            src={`/hud-icons/${icon}.png`}
            width={32}
            height={32}
            alt=""
            onError={() => { setFailed(true); }}
          />
        )}
      {/* Só `error` ganha marcador próprio; o selo dourado muda o botão inteiro. */}
      {badge === 'danger' && <span className="topbar-icon-badge-dot" aria-hidden="true" />}
    </IconButton>
  );
}

export function TopBar({ open, toggle, chatBadge }: {
  open: Readonly<Record<WindowId, boolean>>;
  toggle: (id: WindowId) => void;
  chatBadge: ChatBadgeTier | null;
}) {
  const characterId = useHudSlice((state) => state.characterId);
  const level = useHudSlice((state) => state.level);
  const gold = useHudSlice((state) => state.gold);
  // A vocação ao lado do level: o NOME vem do catálogo, o id do `player-stats` (herdado, #154).
  const vocationId = useHudSlice((state) => state.vocationId);
  const vocationName = useHudSlice((state) =>
    state.catalogue?.vocations.find((vocation) => vocation.id === state.vocationId)?.name ?? null);
  // "—" até o primeiro `player-count`/`session-state.onlinePlayers` (SV-15): nunca `0` inventado.
  const onlinePlayers = useHudSlice((state) => state.onlinePlayers);
  const characters = useStoreSlice(account, (state) => state.characters);
  const name = characters.find((character) => character.id === characterId)?.name ?? null;
  const initial = (name ?? characterId ?? '?').slice(0, 1).toUpperCase();

  // `world` não avisa ninguém (ADR 0007): o retrato amostra por intervalo, como
  // `BattlePanel`/`PartyMembers` já fazem.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, []);
  const outfit = selfOutfit();

  return (
    <header className="topbar" aria-label="barra do topo">
      <div className="topbar-left">
        {/* Retrato e primeiro ícone levam ao mesmo modal Personagem (#319, ADR 0030 §3). */}
        <button
          type="button"
          className="topbar-portrait"
          title="Personagem"
          data-window="character"
          onClick={() => { toggle('character'); }}
        >
          {outfit === null
            ? initial
            : <OutfitSprite outfitId={outfit.appearanceId} name={name ?? characterId ?? undefined} colors={outfit.colors} />}
        </button>
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
              badge={window.id === 'chat' ? chatBadge : null}
              onClick={() => { toggle(window.id); }}
            />
          ))}
        </nav>
      </div>
    </header>
  );
}
