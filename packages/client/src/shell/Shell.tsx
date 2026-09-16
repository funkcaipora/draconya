// A geografia do §5.3 (FUN-24), com a cara do Huntera (FUN-115).
//
// O mundo ocupa a tela inteira; a barra do topo, as janelas à esquerda e à direita e o chat
// flutuam por cima. Gold e o estado da conexão moram na barra; HP e mana moram no alto da
// coluna direita desde #253 (`Vitals`, primeiro filho de `windows-right`).
//
// A GEOGRAFIA É FIXA (§5.3, §5.5): inventário e analisador à direita, hunts e bot à esquerda,
// chat embaixo — nos mesmos lugares em hunt e em conteúdo manual. A tela não se reorganiza ao
// trocar de atividade; em PvP manual, procurar onde a poção foi parar é o que custa a luta.
//
// Nenhum componente daqui lê estado de MUNDO. Onde as criaturas estão é assunto do canvas, que
// lê `world` direto no laço de quadro — é o que faz 40 criaturas andando custarem zero render.
//
// O pacote de arte é montado AQUI (FUN-108) e desce por contexto: o viewport desenha o mundo
// com ele, e o inventário desenha o sprite de cada item. A casca (painéis, barras, slots) é
// CSS puro desde #250 — não lê nenhuma variável do pacote. Ver `AssetPackContext`.

import { useState } from 'react';
import { AssetPackContext } from './AssetPackContext.js';
import { useBrowserPack } from './useBrowserPack.js';
import { useWarmHuntOutfits } from './useWarmHuntOutfits.js';
import { useWalkKeys } from './useWalkKeys.js';
import { Viewport } from './Viewport.js';
import { BattlePanel } from './BattlePanel.js';
import { Chat } from './Chat.js';
import { Analyzer } from './Analyzer.js';
import { Bestiary } from './Bestiary.js';
import { HuntMenu } from './HuntMenu.js';
import { PartyBag } from './PartyBag.js';
import { BotPanel } from './BotPanel.js';
import { CharacterPanel } from './CharacterPanel.js';
import { EquipmentPanel } from './EquipmentPanel.js';
import { ContainerWindow } from './ContainerWindow.js';
import { VocationChoice } from './VocationChoice.js';
import { Vitals } from './Vitals.js';
import { TopBar } from './TopBar.js';
import type { WindowId } from './TopBar.js';

/**
 * Quais janelas nascem abertas: as do loop de todo dia. Bot e Bestiário são visita. Set,
 * mochila e bolsa são FIXOS (ADR 0026 d.7, #161): o botão da barra minimiza os três, nunca remove.
 * Chat nasce aberto (D5/DS-09, #252): "é onde chegam as recusas do servidor" — uma janela que
 * abre fechada esconderia a primeira recusa da sessão.
 */
const DEFAULT_WINDOWS: Readonly<Record<WindowId, boolean>> = {
  hunts: true, bot: true, inventory: true, analyzer: true, bestiary: false, chat: true,
};

export function Shell() {
  const loaded = useBrowserPack();
  const [open, setOpen] = useState(DEFAULT_WINDOWS);
  const toggle = (id: WindowId): void => { setOpen((state) => ({ ...state, [id]: !state[id] })); };
  // As folhas dos monstros das hunts, decodificadas na Cidade (FUN-112): sem isto o rato era
  // um quadrado por seis a dez segundos na primeira entrada.
  useWarmHuntOutfits(loaded?.pack ?? null);
  // Setas e WASD andam (FUN-122): a janela inteira ouve, o canvas não tem foco.
  useWalkKeys();

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
          {/* O bot é FIXO à esquerda (#162, ADR 0026 d.7 — o vBot no `getLeftPanel()`): sempre
              montado; a barra do topo MINIMIZA, nunca remove. A edição fina abre por cima. */}
          <BotPanel collapsed={!open.bot} onToggle={() => { toggle('bot'); }} />
          {/* Personagem é FIXO (D6): sempre montado, sem `open.*` — minimiza pelo próprio
              cabeçalho do Panel (DS-04), não pela barra do topo (não há ícone "Personagem"). */}
          <CharacterPanel />
        </div>
        <div className="windows windows-right" aria-label="janelas à direita">
          {/* As vitais no alto da coluna (#253, ADR 0029 D3): saíram do topo — a barra do topo
              não desenha HP/mana no design (#251). */}
          <Vitals />
          {/* A coluna do OTClient (#161): set, mochila e bolsa FIXOS — um botão da barra
              minimiza os três juntos —, e abaixo deles o analisador e o Bestiário. */}
          <EquipmentPanel collapsed={!open.inventory} onToggle={() => { toggle('inventory'); }} />
          <ContainerWindow container="backpack" collapsed={!open.inventory} />
          <ContainerWindow container="satchel" collapsed={!open.inventory} />
          {/* A batalha (#254, DS-11): quem está na tela, fora o próprio personagem e a party —
              esses já têm painel próprio. Minimiza sozinha (DT-02). */}
          <BattlePanel />
          {/* A bolsa da party (#197): só no modo compartilhado; minimiza com o inventário. */}
          <PartyBag collapsed={!open.inventory} />
          {open.analyzer && <Analyzer />}
          {open.bestiary && <Bestiary />}
        </div>
        {/* Fora das colunas: é uma sobreposição, e as colunas são um contexto de empilhamento
            abaixo da barra do topo — dentro delas o diálogo ficaria por baixo da barra. */}
        {/* A escolha de vocação (#154): sobreposição pela mesma razão do bot, e some sozinha
            quando `vocationId` chega — quem decide se ela existe é o estado, não a barra. */}
        <VocationChoice />
        {/* O chat é janela flutuante fixa (#252, ADR 0029 D5): mesmo padrão de open/close das
            outras (hunts, analyzer, bestiary) — a diferença é só a POSIÇÃO, dada pelo próprio
            componente via `.chat-window`, e não por uma coluna do `windows-left`/`windows-right`. */}
        {open.chat && <Chat onClose={() => { toggle('chat'); }} />}
      </div>
    </AssetPackContext.Provider>
  );
}
