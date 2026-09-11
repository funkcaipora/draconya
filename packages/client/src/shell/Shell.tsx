// A geografia do §5.3 (FUN-24), com a cara do Huntera (FUN-115).
//
// O mundo ocupa a tela inteira; a barra do topo, as janelas à esquerda e à direita e o chat
// flutuam por cima. HP, mana, gold e o estado da conexão moram na barra.
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

import { useEffect, useState } from 'react';
import { applyUiSkin } from '../assets/ui.js';
import { AssetPackContext } from './AssetPackContext.js';
import { useBrowserPack } from './useBrowserPack.js';
import { useWarmHuntOutfits } from './useWarmHuntOutfits.js';
import { Viewport } from './Viewport.js';
import { Chat } from './Chat.js';
import { Analyzer } from './Analyzer.js';
import { Bestiary } from './Bestiary.js';
import { HuntMenu } from './HuntMenu.js';
import { BotPanel } from './BotPanel.js';
import { Inventory } from './Inventory.js';
import { TopBar } from './TopBar.js';
import type { WindowId } from './TopBar.js';

/** Quais janelas nascem abertas: as do loop de todo dia. Bot e Bestiário são visita. */
const DEFAULT_WINDOWS: Readonly<Record<WindowId, boolean>> = {
  hunts: true, bot: false, inventory: true, analyzer: true, bestiary: false,
};

export function Shell() {
  const loaded = useBrowserPack();
  const [open, setOpen] = useState(DEFAULT_WINDOWS);
  const toggle = (id: WindowId): void => { setOpen((state) => ({ ...state, [id]: !state[id] })); };
  // As folhas dos monstros das hunts, decodificadas na Cidade (FUN-112): sem isto o rato era
  // um quadrado por seis a dez segundos na primeira entrada.
  useWarmHuntOutfits(loaded?.pack ?? null);

  useEffect(() => {
    // As variáveis vivem no `:root` e valem para a casca inteira. Não dependem do pacote ter
    // CARREGADO — são URLs de PNG que o navegador busca sozinho —, só de haver um caminho.
    applyUiSkin(document.documentElement, import.meta.env.VITE_THINGS_URL);
  }, []);

  // A geografia do Huntera (FUN-115): o mundo ocupa a tela inteira, e o resto FLUTUA por cima —
  // a barra do topo, as janelas à esquerda e à direita, o chat embaixo. Cada janela é a seção
  // de sempre, só que posicionada; abrir e fechar é da barra do topo. A seção que devolve
  // `null` (analisador na Cidade, bestiário sem catálogo) não deixa moldura vazia para trás,
  // porque a moldura É a seção.
  return (
    <AssetPackContext.Provider value={loaded}>
      <div className="shell">
        <Viewport />
        <TopBar open={open} toggle={toggle} />
        <div className="windows windows-left" aria-label="janelas à esquerda">
          {open.hunts && <HuntMenu />}
        </div>
        <div className="windows windows-right" aria-label="janelas à direita">
          {open.inventory && <Inventory />}
          {open.analyzer && <Analyzer />}
          {open.bestiary && <Bestiary />}
        </div>
        {/* Fora das colunas: é uma sobreposição, e as colunas são um contexto de empilhamento
            abaixo da barra do topo — dentro delas o diálogo ficaria por baixo da barra. */}
        {open.bot && <BotPanel onClose={() => { toggle('bot'); }} />}
        <Chat />
      </div>
    </AssetPackContext.Provider>
  );
}
