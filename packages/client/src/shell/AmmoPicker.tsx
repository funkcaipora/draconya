// O seletor de munição (#161, ADR 0026 decisão 3 — o modelo do Huntera).
//
// Munição não é item nem pilha: é uma SELEÇÃO por família, mostrada no slot do escudo quando
// há um bow na mão. Aqui a lista da família — sprite, nome, attack, preço por tiro ou "grátis",
// level exigido — e um clique manda `select-ammo`. A escolha aparece quando `player-stats.ammo`
// volta; a tela nunca a assume. Level maior que o do personagem vem desabilitado só para não
// oferecer o que o servidor vai recusar — quem confere é ele.

import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import type { Catalogue } from '../state/hud.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';

export type AmmoOption = Catalogue['ammunition'][number];

/** A munição em uso de uma família: a escolhida, ou a grátis quando não há escolha. */
export function ammoInUse(
  ammunition: readonly AmmoOption[], family: string, chosen: string | null,
): AmmoOption | undefined {
  const mine = ammunition.filter((ammo) => ammo.family === family);
  return mine.find((ammo) => ammo.id === chosen) ?? mine.find((ammo) => ammo.price === 0);
}

export function AmmoPicker({ family, onClose }: { family: string; onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const ammo = useHudSlice((state) => state.ammo);
  const level = useHudSlice((state) => state.level);
  const chosen = family === 'arrow' ? ammo.arrow : family === 'bolt' ? ammo.bolt : null;
  const options = (catalogue?.ammunition ?? []).filter((option) => option.family === family);

  return (
    <div className="ammo-picker" role="dialog" aria-label="munição">
      <Panel title="Munição" onClose={onClose}>
        {options.length === 0 && <p className="quiet">Nenhuma munição</p>}
        <ul className="ammo-options">
          {options.map((option) => {
            const locked = option.requires.level !== undefined && level > 0 && level < option.requires.level;
            const active = (chosen ?? undefined) === option.id || (chosen === null && option.price === 0);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`ammo-option${active ? ' active' : ''}`}
                  disabled={locked}
                  aria-pressed={active}
                  onClick={() => {
                    // INTENÇÃO (invariante 4): o cliente diz QUAL; o servidor confere o level.
                    sendIntent({ type: 'select-ammo', ammoId: option.id });
                    onClose();
                  }}
                >
                  <ItemSprite appearanceId={option.appearanceId} name={option.name} />
                  <span className="ammo-name">{option.name}</span>
                  <span className="entry-meta">
                    {`atk ${String(option.attack)} · ${option.price === 0 ? 'grátis' : `${String(option.price)} gold/tiro`}`}
                    {option.requires.level !== undefined && ` · lv ${String(option.requires.level)}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
