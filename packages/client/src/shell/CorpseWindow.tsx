// A janela do cadáver (#722, ADR 0048 d.4): o que o Quick Loot automático do abate (#721) não
// coletou, para quem estiver perto e for dono/elegível — o servidor já conferiu os dois antes de
// mandar `corpse-contents`. Reaproveita o mesmo desenho do `ContainerWindow` (`Panel`/`Slot`/
// `ItemSprite`), mas SEM arrastar: aqui o gesto é sempre "tirar do cadáver", nunca "trocar de
// lugar dentro dele" — então o clique BASTA.
//
// **Estado de TELA, não de jogo** (`state/hud.ts`, `corpse`). Abre pelo clique no mundo (fora
// deste arquivo — `Viewport.tsx`); fecha sozinha quando o cadáver decai (`ground-item-disappear`
// em `state/apply.ts`) ou quando o jogador clica de novo em "Fechar". Reanexar não a reabre.

import { sendIntent } from '../net/current.js';
import { useHudSlice } from '../state/useSlice.js';
import { hud } from '../state/hud.js';
import { ItemSprite } from './ItemSprite.js';
import { FloatingWindow } from './FloatingWindow.js';
import { Slot } from './ui/Slot.js';
import { Button } from './ui/Button.js';

/** Fecha a janela — não manda nada ao servidor, é só a tela deixando de mostrar (DT-03). */
function close(): void {
  hud.set((state) => ({ ...state, corpse: null }));
}

export function CorpseWindow() {
  const corpse = useHudSlice((state) => state.corpse);
  const catalogue = useHudSlice((state) => state.catalogue);

  if (corpse === null) return null;

  const byId = new Map((catalogue?.items ?? []).map((item) => [item.id, item]));
  const groundItemId = corpse.groundItemId;

  return (
    <FloatingWindow
      name="corpse" title="Cadáver" initial={{ x: 420, y: 160 }}
      className="ui-floating-window--corpse" onClose={close}
    >
      {corpse.gold > 0 && <p className="corpse-window-gold">{corpse.gold} gp</p>}
      {corpse.items.length === 0
        ? <p className="quiet">Nada mais aqui.</p>
        : (
          <ul className="container-grid">
            {corpse.items.map((item) => {
              const definition = byId.get(item.itemId);
              const name = definition?.name ?? item.itemId;
              return (
                <li key={item.instanceId}>
                  <Slot
                    size={26}
                    kind="loot"
                    title={`Pegar ${name}`}
                    onClick={() => {
                      sendIntent({ type: 'take-loot', groundItemId, instanceId: item.instanceId });
                    }}
                    icon={<ItemSprite appearanceId={definition?.appearanceId} name={name} />}
                    count={item.quantity}
                  />
                </li>
              );
            })}
          </ul>
        )}
      {(corpse.items.length > 0 || corpse.gold > 0) && (
        <Button
          variant="secondary" size="sm" block
          onClick={() => { sendIntent({ type: 'take-loot', groundItemId, instanceId: null }); }}
        >
          Pegar tudo
        </Button>
      )}
    </FloatingWindow>
  );
}
