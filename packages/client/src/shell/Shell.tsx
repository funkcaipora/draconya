// A geografia do §5.3, sem as janelas ainda (FUN-24).
//
// Viewport ao centro, painéis laterais, chat no canto inferior esquerdo, indicadores de HP e
// mana, e o estado da conexão.
//
// A GEOGRAFIA É FIXA (§5.3, §5.5): inventário e analisador à direita, hunts e bot à esquerda,
// chat embaixo — nos mesmos lugares em hunt e em conteúdo manual. A tela não se reorganiza ao
// trocar de atividade; em PvP manual, procurar onde a poção foi parar é o que custa a luta.
//
// Nenhum componente daqui lê estado de MUNDO. Onde as criaturas estão é assunto do canvas, que
// lê `world` direto no laço de quadro — é o que faz 40 criaturas andando custarem zero render.
//
// O pacote de arte é montado AQUI (FUN-108) e desce por contexto: o viewport desenha o mundo
// com ele, o inventário desenha o sprite de cada item, e a skin de UI — pedra, moldura, slot,
// barras — entra por variável CSS no `:root`, uma vez. Ver `AssetPackContext`.

import { useEffect } from 'react';
import { applyUiSkin } from '../assets/ui.js';
import { useHudSlice } from '../state/useSlice.js';
import { AssetPackContext } from './AssetPackContext.js';
import { useBrowserPack } from './useBrowserPack.js';
import { useWarmHuntOutfits } from './useWarmHuntOutfits.js';
import { Viewport } from './Viewport.js';
import { ConnectionBadge } from './ConnectionBadge.js';
import { Vitals } from './Vitals.js';
import { Chat } from './Chat.js';
import { Analyzer } from './Analyzer.js';
import { HuntMenu } from './HuntMenu.js';
import { BotPanel } from './BotPanel.js';
import { Inventory } from './Inventory.js';

export function Shell() {
  const characterId = useHudSlice((state) => state.characterId);
  const loaded = useBrowserPack();
  // As folhas dos monstros das hunts, decodificadas na Cidade (FUN-112): sem isto o rato era
  // um quadrado por seis a dez segundos na primeira entrada.
  useWarmHuntOutfits(loaded?.pack ?? null);

  useEffect(() => {
    // As variáveis vivem no `:root` e valem para a casca inteira. Não dependem do pacote ter
    // CARREGADO — são URLs de PNG que o navegador busca sozinho —, só de haver um caminho.
    applyUiSkin(document.documentElement, import.meta.env.VITE_THINGS_URL);
  }, []);

  return (
    <AssetPackContext.Provider value={loaded}>
      <div className="shell">
        <aside className="panel panel-left" aria-label="painéis à esquerda">
          <HuntMenu />
          <BotPanel />
        </aside>
        <section className="stage">
          <header className="stage-top">
            <span className="character">{characterId ?? 'sem personagem'}</span>
            <ConnectionBadge />
          </header>
          <Viewport />
          <Vitals />
        </section>
        <aside className="panel panel-right" aria-label="painéis à direita">
          <Inventory />
          <Analyzer />
        </aside>
        <Chat />
      </div>
    </AssetPackContext.Provider>
  );
}
