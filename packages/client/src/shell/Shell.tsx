// A geografia do §5.3, sem as janelas ainda (FUN-24).
//
// Viewport ao centro, lugar reservado para os painéis laterais, chat no canto inferior
// esquerdo, indicadores de HP e mana, e o estado da conexão. Janelas, inventário, bot e
// analisador são F2.
//
// Nenhum componente daqui lê estado de MUNDO. Onde as criaturas estão é assunto do canvas, que
// lê `world` direto no laço de quadro — é o que faz 40 criaturas andando custarem zero render.

import { useHudSlice } from '../state/useSlice.js';
import { Viewport } from './Viewport.js';
import { ConnectionBadge } from './ConnectionBadge.js';
import { Vitals } from './Vitals.js';
import { Chat } from './Chat.js';

export function Shell() {
  const characterId = useHudSlice((state) => state.characterId);

  return (
    <div className="shell">
      <aside className="panel panel-left" aria-label="painéis à esquerda" />
      <section className="stage">
        <header className="stage-top">
          <span className="character">{characterId ?? 'sem personagem'}</span>
          <ConnectionBadge />
        </header>
        <Viewport />
        <Vitals />
      </section>
      <aside className="panel panel-right" aria-label="painéis à direita" />
      <Chat />
    </div>
  );
}
